import { randomUUID } from "node:crypto";
import { listWorkflowRefs, waitForHook } from "@workflow/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resumeHook, start, type Run } from "workflow/api";
import { getWorld } from "workflow/runtime";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { observeDefaultResultStream, type DefaultResultStreamSdkMutationInput } from "@/server/services/default-result-stream-sdk";
import { localDefaultResultHolderWorkflow, localDefaultResultOperationWorkflow } from "./fixtures/default-result-stream.workflow";

const handles: Run<unknown>[] = [];
const terminal = new Set(["completed", "failed", "cancelled"]);
let isolated = false;

beforeAll(() => {
  expect(process.env.MVP_LOCAL_SDK_ONLY).toBe("1");
  expect(process.env.WORKFLOW_TARGET).toBe("local");
  expect(process.env.WORKFLOW_TARGET_WORLD).toBe("local");
  expect(process.env.MVP_ACCEPTANCE_ISOLATED_DB).toBeUndefined();
  expect(process.env.DATABASE_URL).toBeUndefined();
  expect(listWorkflowRefs().map((ref) => ref.name).sort()).toEqual([
    "localDefaultResultHolderWorkflow", "localDefaultResultOperationWorkflow",
  ]);
  isolated = true;
});

afterEach(async () => {
  if (!isolated) return;
  vi.restoreAllMocks();
  const results = await Promise.allSettled(handles.splice(0).map(async (handle) => {
    if (!terminal.has(await handle.status)) await handle.cancel();
    await expect.poll(async () => terminal.has(await handle.status), { timeout: 10_000, interval: 100 }).toBe(true);
    const status = await handle.status;
    expect(terminal.has(status)).toBe(true);
    console.info("LOCAL_SDK_TERMINAL", JSON.stringify({ runId: handle.runId, status }));
  }));
  const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length) throw new AggregateError(failures, "本机成果流测试仍有执行未确认终态");
});

async function holder() {
  const token = `local-default-result-sdk:${randomUUID()}`;
  const root = await start(localDefaultResultHolderWorkflow, [token]);
  handles.push(root);
  const hook = await waitForHook(root, { token });
  expect(hook.runId).toBe(root.runId);
  const frozen = freezeDefaultResultFrame({
    runId: randomUUID(), status: "completed", outcome: "completed", finishedAt: "2026-10-12T00:00:00.000Z",
    result: { amount: 0, approved: false },
  });
  const input: DefaultResultStreamSdkMutationInput = {
    owner: { workspaceId: randomUUID(), runId: frozen.frame.runId, sdkRunId: root.runId, root: true, frameHash: frozen.frameHash },
    frozen, producerSettled: true, sendAttempts: 0, timeoutMs: 30_000,
  };
  return { token, root, input };
}

async function operation(input: DefaultResultStreamSdkMutationInput, kind: "write" | "close") {
  const handle = await start(localDefaultResultOperationWorkflow, [input, kind]);
  handles.push(handle);
  return handle.returnValue;
}

describe("独立本机 SDK 5 成果流，不连接业务数据库", () => {
  it("实际空默认流写入并关闭后，原 Hook 仍暂停，显式恢复后才完成", async () => {
    const fixture = await holder();
    await expect(observeDefaultResultStream(fixture.input)).resolves.toMatchObject({
      readStatus: "verified_snapshot", metadata: { done: false, tailIndex: -1 }, matchedFrames: 0,
    });
    await expect(operation(fixture.input, "write")).resolves.toMatchObject({
      ok: true, observation: { readStatus: "verified_snapshot", matchedFrames: 1, metadata: { done: false, tailIndex: 0 } },
    });
    await expect(operation(fixture.input, "close")).resolves.toMatchObject({
      ok: true, observation: { readStatus: "verified_snapshot", matchedFrames: 1, metadata: { done: true, tailIndex: 0 } },
    });
    expect(await fixture.root.status).toBe("running");
    await resumeHook(fixture.token, true);
    await expect(fixture.root.returnValue).resolves.toEqual({ status: "completed" });
    expect(await fixture.root.status).toBe("completed");
    await expect(observeDefaultResultStream(fixture.input)).resolves.toMatchObject({
      metadata: { done: true, tailIndex: 0 }, matchedFrames: 1,
    });
    await expect(operation(fixture.input, "write")).resolves.toMatchObject({
      ok: false, acknowledgement: "none", code: "decision-rejected",
    });
  });

  it("实际追加后回执丢失时不自动重发，未确认前次结束时不能关闭", async () => {
    const fixture = await holder();
    const world = await getWorld();
    const original = world.streams.write.bind(world.streams);
    const write = vi.spyOn(world.streams, "write").mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("测试注入：追加已提交但回执丢失");
    });
    await expect(operation(fixture.input, "write")).resolves.toMatchObject({
      ok: false, acknowledgement: "unknown", code: "acknowledgement-unknown",
    });
    expect(write).toHaveBeenCalledOnce();
    write.mockRestore();
    await expect(observeDefaultResultStream({ ...fixture.input, producerSettled: false })).resolves.toMatchObject({
      matchedFrames: 1, producerSettled: false, metadata: { done: false, tailIndex: 0 },
    });
    await expect(operation({ ...fixture.input, producerSettled: false }, "close")).resolves.toMatchObject({
      ok: false, acknowledgement: "none", code: "decision-rejected",
    });
  });

  it("实际首次元数据读取失败时不发送任何成果", async () => {
    const fixture = await holder();
    const world = await getWorld();
    const metadata = vi.spyOn(world.streams, "getInfo").mockRejectedValueOnce(new Error("测试注入：首次元数据查询失败"));
    const write = vi.spyOn(world.streams, "write");
    await expect(operation(fixture.input, "write")).resolves.toMatchObject({
      ok: false, acknowledgement: "none", code: "observation-failed",
    });
    expect(metadata).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it("只取消本测试持有的暂停执行，并再次读取实际取消终态", async () => {
    const fixture = await holder();
    expect(await fixture.root.status).toBe("running");
    await fixture.root.cancel();
    await expect.poll(() => fixture.root.status, { timeout: 10_000, interval: 100 }).toBe("cancelled");
  });
});
