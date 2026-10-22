import { getRun } from "workflow/api";
import { getWorld } from "workflow/runtime";
import {
  DefaultResultStreamObservation, DefaultResultStreamOwner, FrozenDefaultResultFrame,
  MAX_DEFAULT_RESULT_FRAME_BYTES, MAX_DEFAULT_RESULT_OBSERVED_FRAMES, MAX_DEFAULT_RESULT_SEND_ATTEMPTS,
} from "@/contracts/default-result-stream";
import { isPassiveJsonData } from "@/contracts/json";
import { classifyDefaultResultFrame, decideDefaultResultStream, freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";

export type DefaultResultStreamSdkInput = {
  owner: DefaultResultStreamOwner;
  frozen: FrozenDefaultResultFrame;
  producerSettled: boolean;
  timeoutMs?: number;
};
export type DefaultResultStreamSdkMutationInput = DefaultResultStreamSdkInput & { sendAttempts: number };

type ErrorCode = "invalid-source" | "observation-failed" | "decision-rejected" | "acknowledgement-unknown" | "acknowledged-unverified";
type Acknowledgement = "none" | "unknown" | "confirmed";
type Metadata = NonNullable<DefaultResultStreamObservation["metadata"]>;
type RunHandle = ReturnType<typeof getRun>;

export class DefaultResultStreamSdkError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly acknowledgement: Acknowledgement = "none",
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "DefaultResultStreamSdkError";
  }
}

class Deadline {
  private readonly expiresAt: number;

  constructor(timeoutMs = 15_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new DefaultResultStreamSdkError("invalid-source", "成果流核对时限无效");
    }
    this.expiresAt = Date.now() + timeoutMs;
  }

  async wait<T>(operation: Promise<T>): Promise<T> {
    const remaining = this.expiresAt - Date.now();
    if (remaining <= 0) {
      void operation.catch(() => undefined);
      throw new Error("成果流操作超过核对时限");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("成果流操作超过核对时限")), Math.max(0, remaining));
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function validate(input: DefaultResultStreamSdkInput) {
  try {
    const charBudget = MAX_DEFAULT_RESULT_FRAME_BYTES * (String(MAX_DEFAULT_RESULT_FRAME_BYTES).length + 1);
    if (!isPassiveJsonData(input.owner, 2_000, 2, 20)
      || !isPassiveJsonData(input.frozen, charBudget, 34, 50_012)
      || typeof input.producerSettled !== "boolean") throw new Error();
    const owner = DefaultResultStreamOwner.parse(input.owner);
    const frozen = FrozenDefaultResultFrame.parse(input.frozen);
    const checked = freezeDefaultResultFrame({
      runId: frozen.frame.runId, status: frozen.frame.status, outcome: frozen.frame.outcome,
      finishedAt: frozen.frame.finishedAt, result: frozen.frame.result,
    });
    if (!owner.root || owner.runId !== frozen.frame.runId || owner.frameHash !== frozen.frameHash
      || checked.frameHash !== frozen.frameHash) throw new Error();
    return { owner, frozen, producerSettled: input.producerSettled };
  } catch (cause) {
    throw new DefaultResultStreamSdkError("invalid-source", "成果流归属或冻结成果无效", "none", cause);
  }
}

function defaultStreamName(sdkRunId: string): string {
  // Workflow 5.0.0 util.ts:56; cross-check against the public Run tail on every observation.
  return `${sdkRunId.replace("wrun_", "strm_")}_user`;
}

function sameMetadata(left: Metadata, right: Metadata): boolean {
  return left.done === right.done && left.tailIndex === right.tailIndex;
}

async function releaseReader(reader: ReadableStreamDefaultReader<unknown>, deadline: Deadline): Promise<void> {
  let failure: unknown;
  let failed = false;
  try { await deadline.wait(reader.cancel()); } catch (cause) { failed = true; failure = cause; }
  finally {
    try { reader.releaseLock(); } catch (cause) { if (!failed) { failed = true; failure = cause; } }
  }
  if (failed) throw failure;
}

async function settleOps(ops: Promise<unknown>[], deadline: Deadline): Promise<void> {
  let offset = 0;
  let failure: unknown;
  let failed = false;
  while (offset < ops.length) {
    const batch = ops.slice(offset);
    offset += batch.length;
    const results = await deadline.wait(Promise.allSettled(batch));
    for (const result of results) {
      if (result.status === "rejected" && !failed) {
        failed = true;
        failure = result.reason;
      }
    }
  }
  if (failed) throw failure;
}

async function observe(
  input: ReturnType<typeof validate>,
  deadline: Deadline,
  run: RunHandle,
): Promise<DefaultResultStreamObservation> {
  const { owner, frozen, producerSettled } = input;
  let metadata: Metadata | null = null;
  let readStatus: DefaultResultStreamObservation["readStatus"] = "unavailable";
  let matchedFrames = 0;
  let conflictingFrames = 0;
  const ops: Promise<unknown>[] = [];
  let reader: ReadableStreamDefaultReader<unknown> | undefined;
  let cancelReadable: ReadableStream<unknown> | undefined;
  let complete = false;
  let failure: unknown;
  let failed = false;

  try {
    if (run.runId !== owner.sdkRunId || !await deadline.wait(run.exists)) throw new Error("成果流所属执行不存在");
    const status = await deadline.wait(run.status);
    if (status !== "running" && status !== "completed") throw new Error("成果流所属执行状态不可核对");
    const world = await deadline.wait(getWorld());
    const name = defaultStreamName(owner.sdkRunId);
    const parseMetadata = DefaultResultStreamObservation.shape.metadata.unwrap();
    const readMetadata = async () => {
      const info = await deadline.wait(world.streams.getInfo(owner.sdkRunId, name));
      return parseMetadata.parse({ done: info.done, tailIndex: info.tailIndex });
    };
    metadata = await readMetadata();
    const before = metadata;
    const readable = run.getReadable<unknown>({ ops, startIndex: 0 });
    if (await deadline.wait(readable.getTailIndex()) !== before.tailIndex) throw new Error("成果流尾部不一致");
    if (before.tailIndex >= MAX_DEFAULT_RESULT_OBSERVED_FRAMES) {
      readStatus = "partial";
    } else {
      readStatus = "partial";
      if (before.tailIndex >= 0) {
        reader = readable.getReader();
        for (let index = 0; index <= before.tailIndex; index += 1) {
          const item = await deadline.wait(reader.read());
          if (item.done) break;
          if (classifyDefaultResultFrame(frozen, item.value) === "match") matchedFrames += 1;
          else conflictingFrames += 1;
        }
      }
      complete = conflictingFrames === 0 && matchedFrames === before.tailIndex + 1;
    }
    if (reader) {
      reader.releaseLock();
      reader = undefined;
      cancelReadable = readable;
    }
    // Public Run read ops settle on lock release; cancelling first rejects the deserialize pipe.
    await settleOps(ops, deadline);
    if (cancelReadable) {
      const usedReadable = cancelReadable;
      cancelReadable = undefined;
      await deadline.wait(usedReadable.cancel());
    }
    metadata = null;
    const after = await readMetadata();
    metadata = after;
    const tail = await deadline.wait(readable.getTailIndex());
    // SDK EOF can succeed when its own metadata lookup fails; it is not our snapshot proof.
    if (complete && sameMetadata(before, after) && tail === after.tailIndex) readStatus = "verified_snapshot";
  } catch (cause) {
    failed = true;
    failure = cause;
  } finally {
    if (reader) {
      try { await releaseReader(reader, deadline); } catch (cause) { if (!failed) { failed = true; failure = cause; } }
    }
    if (cancelReadable) {
      try { await deadline.wait(cancelReadable.cancel()); } catch (cause) { if (!failed) { failed = true; failure = cause; } }
    }
    try { await settleOps(ops, deadline); } catch (cause) { if (!failed) { failed = true; failure = cause; } }
  }
  if (failed) throw new DefaultResultStreamSdkError("observation-failed", "成果流尚未完成可信读回核对", "none", failure);
  return DefaultResultStreamObservation.parse({
    workspaceId: owner.workspaceId, runId: owner.runId, sdkRunId: owner.sdkRunId, frameHash: owner.frameHash,
    metadata, readStatus, matchedFrames, conflictingFrames, producerSettled,
  });
}

export async function observeDefaultResultStream(input: DefaultResultStreamSdkInput): Promise<DefaultResultStreamObservation> {
  const parsed = validate(input);
  const deadline = new Deadline(input.timeoutMs);
  try {
    return await observe(parsed, deadline, getRun(parsed.owner.sdkRunId));
  } catch (cause) {
    if (cause instanceof DefaultResultStreamSdkError) throw cause;
    throw new DefaultResultStreamSdkError("observation-failed", "成果流尚未完成可信读回核对", "none", cause);
  }
}

async function mutate(input: DefaultResultStreamSdkMutationInput, kind: "write" | "close"): Promise<DefaultResultStreamObservation> {
  const parsed = validate(input);
  const deadline = new Deadline(input.timeoutMs);
  if (!Number.isSafeInteger(input.sendAttempts) || input.sendAttempts < 0 || input.sendAttempts > MAX_DEFAULT_RESULT_SEND_ATTEMPTS) {
    throw new DefaultResultStreamSdkError("invalid-source", "成果流发送次数无效");
  }
  let run: RunHandle;
  try { run = getRun(parsed.owner.sdkRunId); }
  catch (cause) { throw new DefaultResultStreamSdkError("observation-failed", "成果流执行上下文暂时不可读取", "none", cause); }
  const observation = await observe(parsed, deadline, run);
  const decision = decideDefaultResultStream({ owner: parsed.owner, observation, sendAttempts: input.sendAttempts });
  if (decision.kind !== kind) throw new DefaultResultStreamSdkError("decision-rejected", decision.reason);
  try {
    if (await deadline.wait(run.status) !== "running") {
      throw new DefaultResultStreamSdkError("decision-rejected", "执行引擎已经结束，不能再次发送或关闭成果流");
    }
  } catch (cause) {
    if (cause instanceof DefaultResultStreamSdkError) throw cause;
    throw new DefaultResultStreamSdkError("observation-failed", "成果流发送前的执行状态尚未确认", "none", cause);
  }

  const ops: Promise<unknown>[] = [];
  let writer: WritableStreamDefaultWriter<FrozenDefaultResultFrame["frame"]> | undefined;
  let failure: unknown;
  let failed = false;
  try {
    const writable = run.getWritable<FrozenDefaultResultFrame["frame"]>({ ops });
    if (ops.length === 0) throw new Error("成果流发送未建立 SDK 持久回执边界");
    writer = writable.getWriter();
    if (kind === "write") await deadline.wait(writer.write(parsed.frozen.frame));
    else await deadline.wait(writer.close());
  } catch (cause) {
    failed = true;
    failure = cause;
    try { if (writer) await deadline.wait(writer.abort()); } catch { /* Preserve the original operation error. */ }
  } finally {
    try { writer?.releaseLock(); } catch (cause) { if (!failed) { failed = true; failure = cause; } }
    try { await settleOps(ops, deadline); } catch (cause) { if (!failed) { failed = true; failure = cause; } }
  }
  if (failed) throw new DefaultResultStreamSdkError("acknowledgement-unknown", "成果流发送或关闭回执尚未确认，不能自动重发", "unknown", failure);

  try {
    const verified = await observe({ ...parsed, producerSettled: true }, deadline, run);
    const next = decideDefaultResultStream({ owner: parsed.owner, observation: verified, sendAttempts: input.sendAttempts });
    if (kind === "write" ? next.kind !== "close" && next.kind !== "confirmed" : next.kind !== "confirmed") {
      throw new Error("明确回执之后的成果流尚未核对完成");
    }
    return verified;
  } catch (cause) {
    throw new DefaultResultStreamSdkError("acknowledged-unverified", "成果流已获得本次明确回执，仍需核对保存状态", "confirmed", cause);
  }
}

export async function writeDefaultResultStreamFrame(input: DefaultResultStreamSdkMutationInput): Promise<DefaultResultStreamObservation> {
  return mutate(input, "write");
}

export async function closeDefaultResultStream(input: DefaultResultStreamSdkMutationInput): Promise<DefaultResultStreamObservation> {
  return mutate(input, "close");
}
