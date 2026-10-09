import { afterEach, describe, expect, it } from "vitest";
import { startMvpAcceptanceTools } from "./mvp-acceptance-tools";

let service: Awaited<ReturnType<typeof startMvpAcceptanceTools>> | undefined;
afterEach(async () => {
  await service?.close();
  service = undefined;
});
async function send(key: string) {
  return fetch(service!.writeEndpoint, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "record_proposal", arguments: { customerId: "c1", amount: 0, approved: false } } }) });
}
const receipt = { ok: true, receiptId: "receipt-1", customerId: "c1", amount: 0, approved: false };

describe("恢复验收假服务的故障注入与实际回执（本机，无数据库或 Workflow）", () => {
  it("第一次丢失回执后相同键返回实际回执，外部测试副作用一次", async () => {
    service = await startMvpAcceptanceTools();
    service.controls.writeFault = "response-lost";
    expect((await send("helper-only-key")).status).toBe(503);
    const recovered = await send("helper-only-key");
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ result: { structuredContent: receipt } });
    expect(service.receipt("helper-only-key")).toEqual(receipt);
    expect(service.writes).toHaveLength(2);
    expect(service.effectCount()).toBe(1);
  });

  it("连续三次503不虚构失败前未写入，查询仍能取得一次实际副作用的回执", async () => {
    service = await startMvpAcceptanceTools();
    service.controls.writeFault = "response-lost-always";
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await send("helper-only-key")).status).toBe(503);
    expect(service.writes).toHaveLength(3);
    expect(service.effectCount()).toBe(1);
    expect(service.receipt("helper-only-key")).toEqual(receipt);
    expect(service.receipt("unknown-key")).toBeUndefined();
  });
});
