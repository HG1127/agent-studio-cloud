import { createHash } from "node:crypto";
import { z } from "zod";
import { RunDeliveryBinding, RunDeliveryTargetId } from "@/contracts/run-delivery";
import { canonicalJson } from "@/server/domain/canonical-json";

const DeliveryTarget = z.object({
  id: RunDeliveryTargetId, revision: z.string().trim().min(1).max(100), endpoint: z.string().url().max(2000),
  idempotent: z.literal(true), retentionMs: RunDeliveryBinding.shape.retentionMs,
  headers: z.record(z.string().min(1).max(100), z.string().max(4000)).default({}),
}).strict();
export type DeliveryTarget = z.infer<typeof DeliveryTarget>;
const forbidden = new Set(["connection", "content-length", "host", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
export function parseDeliveryTargets(raw: string | undefined, allowLoopback = false): DeliveryTarget[] {
  if (!raw?.trim() || raw.length > 256 * 1024) return [];
  try {
    const targets = z.array(DeliveryTarget).max(50).parse(JSON.parse(raw));
    const ids = new Set<string>();
    for (const target of targets) {
      const url = new URL(target.endpoint);
      const local = allowLoopback && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (ids.has(target.id) || url.username || url.password || url.hash || (url.protocol !== "https:" && !local)
        || Object.keys(target.headers).length > 20
        || Object.entries(target.headers).some(([key, value]) => /[\r\n:]/.test(key) || /[\r\n]/.test(value) || forbidden.has(key.toLowerCase()))) return [];
      new Headers(target.headers);
      ids.add(target.id);
    }
    return targets;
  } catch { return []; }
}
export function getDeliveryTarget(id: string): DeliveryTarget | null {
  return parseDeliveryTargets(process.env.RUN_DELIVERY_TARGETS_JSON, process.env.NODE_ENV === "test").find((target) => target.id === id) ?? null;
}
export function deliveryTargetBinding(target: DeliveryTarget): RunDeliveryBinding {
  const endpoint = new URL(target.endpoint).href;
  const headers = Object.fromEntries([...new Headers(target.headers)].filter(([key]) => key !== "authorization"));
  return RunDeliveryBinding.parse({ targetId: target.id, retentionMs: target.retentionMs,
    targetHash: createHash("sha256").update(canonicalJson({ id: target.id, revision: target.revision, endpoint, headers, retentionMs: target.retentionMs })).digest("hex") });
}
