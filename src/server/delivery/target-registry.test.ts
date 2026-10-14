import { describe, expect, it } from "vitest";
import { deliveryTargetBinding, parseDeliveryTargets } from "./target-registry";

const target = { id: "crm", revision: "1", endpoint: "https://receiver.test/results", idempotent: true, retentionMs: 300_000, headers: { Authorization: "Bearer secret" } };
describe("服务端成果接收方", () => {
  it("必须明确防重保证和有效期", () => {
    expect(parseDeliveryTargets(JSON.stringify([target]))).toHaveLength(1);
    for (const change of [{ idempotent: false }, { retentionMs: 1000 }, { retentionMs: undefined }, { revision: undefined }]) expect(parseDeliveryTargets(JSON.stringify([{ ...target, ...change }]))).toEqual([]);
  });
  it.each(["http://receiver.test", "https://user:secret@receiver.test", "https://receiver.test/#fragment", "file:///secret", "javascript:bad"])("拒绝不安全地址 %s", (endpoint) => {
    expect(parseDeliveryTargets(JSON.stringify([{ ...target, endpoint }]))).toEqual([]);
  });
  it("本机假服务只能显式用于测试", () => {
    const raw = JSON.stringify([{ ...target, endpoint: "http://127.0.0.1:3999/result" }]);
    expect(parseDeliveryTargets(raw)).toEqual([]);
    expect(parseDeliveryTargets(raw, true)).toHaveLength(1);
    expect(parseDeliveryTargets(JSON.stringify([{ ...target, endpoint: "http://other.test" }]), true)).toEqual([]);
  });
  it("拒绝重复标识、损坏配置和危险请求头", () => {
    expect(parseDeliveryTargets("not-json")).toEqual([]);
    expect(parseDeliveryTargets(JSON.stringify([target, target]))).toEqual([]);
    for (const headers of [{ Host: "other.test" }, { "Bad:Header": "secret" }, { Authorization: "secret\r\nother: x" }, { "Connection": "keep-alive" }]) expect(parseDeliveryTargets(JSON.stringify([{ ...target, headers }]))).toEqual([]);
  });
  it("冻结地址、语义版本与有效期，允许原地址凭据轮换", () => {
    const first = parseDeliveryTargets(JSON.stringify([target]))[0];
    const changedSecret = parseDeliveryTargets(JSON.stringify([{ ...target, headers: { Authorization: "Bearer rotated" } }]))[0];
    expect(deliveryTargetBinding(changedSecret)).toEqual(deliveryTargetBinding(first));
    for (const change of [{ endpoint: "https://other.test" }, { revision: "2" }, { retentionMs: 600_000 }, { headers: { Authorization: "Bearer rotated", "X-Tenant": "other" } }]) expect(deliveryTargetBinding(parseDeliveryTargets(JSON.stringify([{ ...target, ...change }]))[0]).targetHash).not.toBe(deliveryTargetBinding(first).targetHash);
  });
});
