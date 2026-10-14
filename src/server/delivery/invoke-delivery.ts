import { RunDeliveryEnvelope, RunDeliveryReceipt } from "@/contracts/run-delivery";
import type { DeliveryTarget } from "./target-registry";
import { readBoundedRequestBytes } from "@/server/security/bounded-request-body";

export type DeliveryInvocation = { ok: true; receipt: RunDeliveryReceipt } | { ok: false; retryable: boolean; error: string };
export async function invokeRunDelivery(args: { target: DeliveryTarget; envelope: RunDeliveryEnvelope; fetchImpl?: typeof fetch }): Promise<DeliveryInvocation> {
  const parsed = RunDeliveryEnvelope.safeParse(args.envelope);
  if (!parsed.success) return { ok: false, retryable: false, error: "最终成果不符合投递契约" };
  const headers = new Headers(args.target.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("accept", "application/json");
  headers.set("idempotency-key", `delivery:${parsed.data.deliveryId}`);
  headers.set("x-agent-studio-delivery-id", parsed.data.deliveryId);
  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(args.target.endpoint, {
      method: "POST", body: JSON.stringify(parsed.data), headers, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
  } catch { return { ok: false, retryable: true, error: "接收方暂时无法连接，等待重试" }; }
  if (response.status !== 200 && response.status !== 201) {
    await response.body?.cancel().catch(() => undefined);
    const retryable = response.status === 202 || [408, 425, 429].includes(response.status) || response.status >= 500;
    return { ok: false, retryable, error: retryable ? "接收方尚未明确确认，等待重试" : `接收方拒绝投递（${response.status}）` };
  }
  const body = await readBoundedRequestBytes(response, 4096);
  if (!body.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, retryable: body.reason === "read_failed", error: "接收回执无法安全读取" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
    const receipt = RunDeliveryReceipt.parse(JSON.parse(text));
    if (receipt.deliveryId !== parsed.data.deliveryId) throw new Error("mismatch");
    return { ok: true, receipt };
  } catch { return { ok: false, retryable: false, error: "接收方未返回本次投递的有效确认回执，请人工核对" }; }
}
