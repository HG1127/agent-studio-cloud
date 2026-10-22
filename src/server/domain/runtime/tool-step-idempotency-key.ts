import { createHash } from "node:crypto";
import { canonicalJson } from "@/server/domain/canonical-json";

export function toolStepIdempotencyKey(args: { runId: string; nodeId: string; stepId: string }): string {
  const legacy = `${args.runId}:${args.nodeId}:${args.stepId}`;
  // 已可发送的旧键必须保留；否则历史写操作重试会被远端当成新操作。
  if (!/[^\t\x20-\x7e\x80-\xff]/.test(legacy)) return legacy;
  return `studio-step-header:v1:${createHash("sha256").update(canonicalJson([args.runId, args.nodeId, args.stepId])).digest("hex")}`;
}
