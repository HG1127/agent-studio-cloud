import { describe, expect, it, vi } from "vitest";
import { invokeRunDelivery } from "./invoke-delivery";
import { parseDeliveryTargets } from "./target-registry";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";
import { RunDeliveryEnvelope } from "@/contracts/run-delivery";

const id = "00000000-0000-4000-8000-000000000158";
const target = parseDeliveryTargets(JSON.stringify([{ id: "crm", revision: "1", endpoint: "https://receiver.test/result", idempotent: true, retentionMs: 300_000, headers: { Authorization: "Bearer private", "idempotency-key": "wrong" } }]))[0];
const envelope = RunDeliveryEnvelope.parse({ schemaVersion: 1, deliveryId: id, task: presentRunTaskResult({ runId: id, status: "completed", result: { amount: 0, approved: false, email: "buyer@example.com", apiKey: "private-key-123" }, error: null, outputContract: { fields: [] } }) });
describe("最终成果 HTTP 投递", () => {
  it("发送冻结业务成果与稳定防重标识，必须取得本次确认", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, deliveryId: id, receiptId: "order-123" }));
    expect(await invokeRunDelivery({ target, envelope, fetchImpl: send })).toEqual({ ok: true, receipt: { ok: true, deliveryId: id, receiptId: "order-123" } });
    const [, options] = send.mock.calls[0];
    const headers = new Headers(options?.headers);
    expect(headers.get("idempotency-key")).toBe(`delivery:${id}`);
    expect(headers.get("authorization")).toBe("Bearer private");
    expect(options?.redirect).toBe("error");
    expect(options?.body).toContain('"amount":0');
    expect(options?.body).toContain('"approved":false');
    expect(options?.body).toContain("buyer@example.com");
    expect(options?.body).not.toContain("private-key-123");
    const second = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, deliveryId: id }));
    await invokeRunDelivery({ target, envelope, fetchImpl: second });
    expect(second.mock.calls[0][1]?.body).toBe(options?.body);
  });
  it.each([202, 408, 425, 429, 500, 503])("HTTP %i 不冒充已交付，允许有界重试", async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    expect(await invokeRunDelivery({ target, envelope, fetchImpl: send })).toMatchObject({ ok: false, retryable: true });
  });
  it.each([301, 400, 401, 403, 404])("HTTP %i 停止自动发送", async (status) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
    expect(await invokeRunDelivery({ target, envelope, fetchImpl: send })).toMatchObject({ ok: false, retryable: false });
  });
  it.each(["", "not-json", { ok: true }, { ok: false, deliveryId: id }, { ok: true, deliveryId: "00000000-0000-4000-8000-000000000159" }, { ok: true, deliveryId: id, extra: "private" }])("不接受空、错误或其他投递的回执 %j", async (body) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(typeof body === "string" ? new Response(body) : Response.json(body));
    expect(await invokeRunDelivery({ target, envelope, fetchImpl: send })).toMatchObject({ ok: false, retryable: false });
  });
  it("实际字节有界并严格校验 UTF-8", async () => {
    for (const response of [new Response("x".repeat(4097)), new Response(new Uint8Array([0xff]))]) {
      const send = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(await invokeRunDelivery({ target, envelope, fetchImpl: send })).toMatchObject({ ok: false, retryable: false });
    }
  });
  it("连接响应丢失可重试，不暴露原错误", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error("Bearer private-database"));
    const result = await invokeRunDelivery({ target, envelope, fetchImpl: send });
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain("private-database");
  });
});
