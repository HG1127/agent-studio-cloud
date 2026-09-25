import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resumeHookMock } = vi.hoisted(() => ({ resumeHookMock: vi.fn() }));
vi.mock("workflow/api", () => ({ resumeHook: resumeHookMock }));

import { POST } from "@/app/api/runs/[runId]/events/[eventKey]/route";
import { runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

const RUN_ID = "00000000-0000-4000-8000-0000000000b3";

afterEach(async () => {
  resumeHookMock.mockReset();
  await db.delete(traceEvents).where(eq(traceEvents.runId, RUN_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
});

async function insertWaitingRun(
  payloadSchema: Record<string, unknown> = { type: "object" },
  hookToken: string | null = `wait:${RUN_ID}:wait_customer:7`,
  submissionToken: string | null = "submission-token",
) {
  await db.insert(runs).values({
    id: RUN_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: "00000000-0000-4000-8000-0000000000b4",
    versionId: "00000000-0000-4000-8000-0000000000b5",
    status: "waiting_event",
    input: {},
  });
  await db.insert(traceEvents).values({
    runId: RUN_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    seq: 1,
    nodeId: "wait_customer",
    kind: "wait.started",
    title: "等待客户补充资料",
    data: {
      eventKey: "customer.profile.updated",
      payloadSchema,
      ...(hookToken ? { hookToken } : {}),
      ...(submissionToken ? { submissionToken } : {}),
    },
  });

}

describe("外部消息恢复接口", () => {
  it("拒绝跨站浏览器提交且不读取运行状态", async () => {
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://malicious.example" },
        body: "{}",
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "不允许从其他站点提交消息" });
    expect(resumeHookMock).not.toHaveBeenCalled();
  });

  it("等待中的运行收到 JSON 对象后恢复匹配钩子", async () => {
    resumeHookMock.mockResolvedValue(undefined);
    await insertWaitingRun();
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wait-event-token": "submission-token" },
        body: JSON.stringify({ customerId: "C-100" }),
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resumeHookMock).toHaveBeenCalledWith(`wait:${RUN_ID}:wait_customer:7`, { customerId: "C-100" });
  });

  it("仍可恢复升级前已经挂起的旧格式等待", async () => {
    resumeHookMock.mockResolvedValue(undefined);
    await insertWaitingRun({ type: "object" }, null, null);
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(200);
    expect(resumeHookMock).toHaveBeenCalledWith(`wait:${RUN_ID}:customer.profile.updated`, {});
  });

  it("缺少一次性凭据时不会恢复新格式等待", async () => {
    await insertWaitingRun();
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "消息提交凭据无效，请刷新页面后重试" });
    expect(resumeHookMock).not.toHaveBeenCalled();
  });

  it("错误的一次性凭据不会恢复新格式等待", async () => {
    await insertWaitingRun();
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wait-event-token": "wrong-token" },
        body: "{}",
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(403);
    expect(resumeHookMock).not.toHaveBeenCalled();
  });

  it("消息不满足等待步骤字段结构时不会恢复", async () => {
    await insertWaitingRun({
      type: "object",
      required: ["customerId", "complete"],
      properties: { customerId: { type: "string" }, complete: { type: "boolean" } },
    });
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wait-event-token": "submission-token" },
        body: JSON.stringify({ customerId: "C-100" }),
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "消息.complete为必填字段" });
    expect(resumeHookMock).not.toHaveBeenCalled();
  });

  it("拒绝包含保留字段的消息且不会恢复", async () => {
    await insertWaitingRun();
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wait-event-token": "submission-token" },
        body: '{"nested":{"__proto__":{"polluted":true}}}',
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "等待消息不能使用保留字段名" });
    expect(resumeHookMock).not.toHaveBeenCalled();
  });

  it("非等待状态不接受外部消息", async () => {
    await db.insert(runs).values({
      id: RUN_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: "00000000-0000-4000-8000-0000000000b4",
      versionId: "00000000-0000-4000-8000-0000000000b5",
      status: "completed",
      input: {},
    });
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(409);
    expect(resumeHookMock).not.toHaveBeenCalled();
  });

  it("拒绝超过限制的外部消息且不读取运行状态", async () => {
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "大".repeat(90_000) }),
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ ok: false, error: "消息内容超过 256KB 限制" });
    expect(resumeHookMock).not.toHaveBeenCalled();
  });
});
