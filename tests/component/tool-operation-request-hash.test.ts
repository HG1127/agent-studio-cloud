import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolOperationResolveInput } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";
import { toolOperationRequestHash } from "@/features/tool-operations/tool-operation-request-hash";

const fields = { operationId: "11111111-1111-4111-8111-111111111111", requestId: "33333333-3333-4333-8333-333333333333", reason: "  已核对真实记录，含中文与零值  " };
const payload = ToolOperationResolveInput.parse({ ...fields, kind: "record-receipt", confirmedCompleted: true, receipt: { 数量: 0, 成功: false, 备注: "", 其他: null, 嵌套: { z: "中", a: [0, false, null] } } });
const expectedHash = (input: ToolOperationResolveInput) => createHash("sha256").update(canonicalJson(ToolOperationResolveInput.parse(input))).digest("hex");
beforeEach(() => { vi.stubGlobal("isSecureContext", true); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("浏览器完整核对请求摘要", () => {
  it.each([
    payload,
    ToolOperationResolveInput.parse({ ...fields, kind: "retry", confirmedNotExecuted: true }),
  ])("与服务端唯一契约解析和共享canonicalJson的SHA-256完全一致 %#", async (input) => {
    expect(await toolOperationRequestHash(input)).toBe(expectedHash(input));
  });
  it("解析原因空格与递归对象键序，保留数组顺序与完整值类型，不改变固定请求", async () => {
    const reordered: ToolOperationResolveInput = { ...payload, reason: fields.reason, ...(payload.kind === "record-receipt" ? { receipt: { 嵌套: { a: [0, false, null], z: "中" }, 其他: null, 备注: "", 成功: false, 数量: 0 } } : {}) };
    const original = JSON.stringify(reordered);
    expect(await toolOperationRequestHash(reordered)).toBe(expectedHash(payload)); expect(JSON.stringify(reordered)).toBe(original);
  });
  it.each([
    { ...payload, reason: "已核对另一份真实业务记录" },
    { ...payload, receipt: { 数量: 1, 成功: false, 备注: "", 其他: null } },
    { ...payload, receipt: { 数量: false, 成功: false, 备注: "", 其他: null } },
  ])("同请求标识与同结论但内容改变时得到不同摘要 %#", async (input) => {
    const parsed = ToolOperationResolveInput.parse(input);
    expect(parsed.requestId).toBe(payload.requestId); expect(parsed.kind).toBe(payload.kind);
    expect(await toolOperationRequestHash(parsed)).toBe(expectedHash(parsed)); expect(await toolOperationRequestHash(parsed)).not.toBe(expectedHash(payload));
  });
  it.each([false, undefined])("非安全或未知浏览器环境拒绝计算，不执行摘要 %#", async (secure) => {
    vi.stubGlobal("isSecureContext", secure); const digest = vi.spyOn(webcrypto.subtle, "digest");
    expect(await toolOperationRequestHash(payload)).toBeNull(); expect(digest).not.toHaveBeenCalled();
  });
  it.each([undefined, { randomUUID: () => payload.requestId }])("缺少浏览器摘要能力保留未知 %#", async (capability) => {
    vi.stubGlobal("crypto", capability); expect(await toolOperationRequestHash(payload)).toBeNull();
  });
  it("摘要执行拒绝或返回长度异常时不提供可确认摘要", async () => {
    const digest = vi.spyOn(webcrypto.subtle, "digest").mockRejectedValueOnce(new Error("能力被拒绝")).mockResolvedValueOnce(new ArrayBuffer(31));
    expect(await toolOperationRequestHash(payload)).toBeNull(); expect(await toolOperationRequestHash(payload)).toBeNull(); expect(digest).toHaveBeenCalledTimes(2);
  });
  it("损坏或缺少明确确认的请求不能计算摘要", async () => {
    const digest = vi.spyOn(webcrypto.subtle, "digest");
    expect(await toolOperationRequestHash({ ...payload, reason: "短" })).toBeNull();
    expect(await toolOperationRequestHash({ ...payload, confirmedCompleted: false } as unknown as ToolOperationResolveInput)).toBeNull(); expect(digest).not.toHaveBeenCalled();
  });
});
