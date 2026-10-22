import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { waitForHook } from "@workflow/vitest";
import { resumeHook, start, type Run } from "workflow/api";
import { getWorld } from "workflow/runtime";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { observeDefaultResultStream, type DefaultResultStreamSdkMutationInput } from "@/server/services/default-result-stream-sdk";
import { defaultResultStreamHolderWorkflow, defaultResultStreamSdkOperationWorkflow } from "./default-result-stream-sdk.workflow";

// These fixtures require the locked SDK 5 Local World; they are not evidence until isolated acceptance executes them.
const handles: Run<unknown>[] = [];
let isolated = false;
beforeAll(() => {
  expect(process.env.MVP_ACCEPTANCE_ISOLATED_DB, "仅专用隔离验收允许启动本套件").toBe("1");
  isolated = true;
});

afterEach(async () => {
  if (!isolated) return;
  vi.restoreAllMocks();
  const results = await Promise.allSettled(handles.splice(0).map(async (handle) => {
    if (!["completed", "failed", "cancelled"].includes(await handle.status)) await handle.cancel();
  }));
  if (results.some((result) => result.status === "rejected")) throw new Error("成果流测试执行尚未确认清理");
});

async function holder() {
  const token = `default-result-sdk:${randomUUID()}`;
  const root = await start(defaultResultStreamHolderWorkflow, [token]);
  handles.push(root);
  await waitForHook(root, { token });
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
  const handle = await start(defaultResultStreamSdkOperationWorkflow, [input, kind]);
  handles.push(handle);
  return handle.returnValue;
}

describe("SDK 5 公开接口的实际步骤边界", () => {
  it("Local World 从未写入的实际根默认流可核对，独立步骤送达关闭后原根才完成", async () => {
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
    await expect(observeDefaultResultStream(fixture.input)).resolves.toMatchObject({ metadata: { done: true, tailIndex: 0 }, matchedFrames: 1 });
    await expect(operation(fixture.input, "write")).resolves.toMatchObject({ ok: false, acknowledgement: "none", code: "decision-rejected" });
  });

  it("实际 World 已追加但 ACK 丢失时只返回未知，不借步骤完成自动重发", async () => {
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

  it("实际 World 首次元数据查询失败时没有发送副作用", async () => {
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
});
