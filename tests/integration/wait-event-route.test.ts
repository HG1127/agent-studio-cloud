import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resumeHookMock } = vi.hoisted(() => ({ resumeHookMock: vi.fn() }));
vi.mock("workflow/api", () => ({ resumeHook: resumeHookMock }));

import { POST } from "@/app/api/runs/[runId]/events/[eventKey]/route";
import { runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

const RUN_ID = "00000000-0000-4000-8000-0000000000b3";

afterEach(async () => {
  resumeHookMock.mockReset();
  await db.delete(runs).where(eq(runs.id, RUN_ID));
});

describe("外部消息恢复接口", () => {
  it("等待中的运行收到 JSON 对象后恢复匹配钩子", async () => {
    resumeHookMock.mockResolvedValue(undefined);
    await db.insert(runs).values({
      id: RUN_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: "00000000-0000-4000-8000-0000000000b4",
      versionId: "00000000-0000-4000-8000-0000000000b5",
      status: "waiting_event",
      input: {},
    });
    const response = await POST(
      new Request(`http://localhost/api/runs/${RUN_ID}/events/customer.profile.updated`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId: "C-100" }),
      }),
      { params: Promise.resolve({ runId: RUN_ID, eventKey: "customer.profile.updated" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resumeHookMock).toHaveBeenCalledWith(`wait:${RUN_ID}:customer.profile.updated`, { customerId: "C-100" });
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
});
