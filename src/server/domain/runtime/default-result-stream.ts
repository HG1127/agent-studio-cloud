import { createHash } from "node:crypto";
import {
  DefaultResultStreamFrame, DefaultResultStreamObservation, DefaultResultStreamOwner,
  FrozenDefaultResultFrame, MAX_DEFAULT_RESULT_FRAME_BYTES, MAX_DEFAULT_RESULT_OBSERVED_FRAMES, MAX_DEFAULT_RESULT_SEND_ATTEMPTS,
  type DefaultResultStreamDecision, type DefaultResultStreamSource,
} from "@/contracts/default-result-stream";
import { isPassiveJsonData, type JsonStorageValue } from "@/contracts/json";
import { canonicalJson } from "@/server/domain/canonical-json";
import { redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

function canonicalFrameValue(value: JsonStorageValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalFrameValue).join(",")}]`;
  if (value && typeof value === "object") {
    // Persistent frame identity must not depend on the host's locale.
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalFrameValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function frameHash(frame: DefaultResultStreamFrame): string {
  return createHash("sha256").update(canonicalFrameValue(frame)).digest("hex");
}

export function freezeDefaultResultFrame(input: DefaultResultStreamSource): FrozenDefaultResultFrame {
  const frame = DefaultResultStreamFrame.parse({
    schemaVersion: 1, kind: "run.result", frameId: input.runId, runId: input.runId,
    status: input.status, outcome: input.outcome, finishedAt: input.finishedAt, result: input.result,
  });
  if (canonicalJson(frame.result) !== canonicalJson(redactStructuredCredentialData(frame.result))) {
    throw new Error("最终成果含未隐藏的凭据，不能发送成果流");
  }
  return { frame, frameHash: frameHash(frame) };
}

export function classifyDefaultResultFrame(expected: FrozenDefaultResultFrame, value: unknown): "match" | "conflict" {
  try {
    const charBudget = MAX_DEFAULT_RESULT_FRAME_BYTES * (String(MAX_DEFAULT_RESULT_FRAME_BYTES).length + 1);
    if (!isPassiveJsonData(expected, charBudget, 34, 50_012)
      || !isPassiveJsonData(value, charBudget, 33, 50_010)) return "conflict";
    const frozen = FrozenDefaultResultFrame.safeParse(expected);
    const parsed = DefaultResultStreamFrame.safeParse(value);
    if (!frozen.success || !parsed.success || frameHash(frozen.data.frame) !== frozen.data.frameHash) return "conflict";
    return frameHash(parsed.data) === frozen.data.frameHash ? "match" : "conflict";
  } catch {
    return "conflict";
  }
}

export function decideDefaultResultStream(args: {
  owner: DefaultResultStreamOwner;
  observation: DefaultResultStreamObservation;
  sendAttempts: number;
}): DefaultResultStreamDecision {
  const owner = DefaultResultStreamOwner.parse(args.owner);
  const observation = DefaultResultStreamObservation.parse(args.observation);
  if (!Number.isSafeInteger(args.sendAttempts) || args.sendAttempts < 0 || args.sendAttempts > MAX_DEFAULT_RESULT_SEND_ATTEMPTS) {
    throw new Error("成果流发送次数无效");
  }
  if (!owner.root) return { kind: "failed", reason: "子流程不能发送或关闭主流程的成果流" };
  if (owner.workspaceId !== observation.workspaceId || owner.sdkRunId !== observation.sdkRunId
    || owner.runId !== observation.runId || owner.frameHash !== observation.frameHash) {
    return { kind: "failed", reason: "成果流不属于本次冻结成果，不能发送或关闭" };
  }
  if (observation.conflictingFrames > 0) return { kind: "failed", reason: "成果流包含不同成果，不能覆盖或再次写入" };
  if (observation.metadata && observation.metadata.tailIndex >= MAX_DEFAULT_RESULT_OBSERVED_FRAMES) {
    return { kind: "failed", reason: "成果流内容超过核对上限，不能确认送达或再次写入" };
  }
  if (!observation.producerSettled) return { kind: "wait", reason: "前次发送尚未确认结束，不能并发补送或关闭" };
  if (!observation.metadata) return { kind: "verify", reason: "成果流存储状态尚未确认" };
  if (observation.readStatus !== "verified_snapshot") {
    if (observation.readStatus === "partial" && observation.metadata.done) {
      return { kind: "failed", reason: "成果流已关闭但成果不完整，不能再次写入" };
    }
    return { kind: "verify", reason: "成果流仍需完整读回核对" };
  }
  if (observation.metadata.tailIndex + 1 !== observation.matchedFrames) {
    return { kind: "verify", reason: "读回成果未覆盖已登记的全部内容" };
  }
  if (observation.metadata.done) {
    return observation.matchedFrames > 0
      ? { kind: "confirmed", reason: "同一冻结成果已完整读回并确认关闭" }
      : { kind: "failed", reason: "成果流已关闭但缺少成果，不能再次写入" };
  }
  if (observation.matchedFrames > 0) return { kind: "close", reason: "冻结成果已读回，仅需关闭并确认" };
  if (args.sendAttempts === MAX_DEFAULT_RESULT_SEND_ATTEMPTS) return { kind: "failed", reason: "成果流自动发送次数已用完" };
  return { kind: "write", reason: "成果流仍为空且未关闭，可以补送同一冻结成果" };
}
