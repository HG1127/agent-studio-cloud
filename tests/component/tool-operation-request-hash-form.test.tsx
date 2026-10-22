import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolOperationResolution, ToolOperationResolveInput, ToolOperationView, type ToolOperationGetResult } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { readToolOperation, submitToolOperationResolution } from "@/features/tool-operations/tool-operation-client";
import { ToolOperationReconciliationForm } from "@/features/tool-operations/ToolOperationReconciliationForm";

vi.mock("@/features/tool-operations/tool-operation-client", () => ({ readToolOperation: vi.fn(), submitToolOperationResolution: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", requestId = "33333333-3333-4333-8333-333333333333";
const operation = ToolOperationView.parse({ id, sourceRunId: runId, nodeTitle: "登记工单", toolId: "private-tool", status: "blocked", error: "业务结果未知", receipt: null, resolutions: [], retryDeadline: "2099-01-01T00:00:00.000Z", createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z" });
const read = vi.mocked(readToolOperation), submit = vi.mocked(submitToolOperationResolution);
const fixedPayload = () => submit.mock.calls[0][0];
const sha = (input: ToolOperationResolveInput) => createHash("sha256").update(canonicalJson(ToolOperationResolveInput.parse(input))).digest("hex");
const makeRecord = (input = fixedPayload()) => ToolOperationResolution.parse({ requestId: input.requestId, kind: input.kind, createdBy: runId, createdAt: operation.updatedAt, reason: redactCredentialText(input.reason), requestHash: sha(input) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("isSecureContext", true); vi.stubGlobal("crypto", webcrypto); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  submit.mockResolvedValue({ ok: false, error: "保存结果无法确认", retryable: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const lock = vi.fn(), observed = vi.fn();
  return { ...render(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />), lock, observed };
}
async function send(user: ReturnType<typeof userEvent.setup>, kind: "record-receipt" | "retry" = "record-receipt", reason = "已查询真实记录 密钥: abcdef1234567890") {
  await user.selectOptions(screen.getByLabelText("业务系统查询结果"), kind);
  fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: reason } });
  if (kind === "record-receipt") fireEvent.change(screen.getByLabelText("实际业务回执", { exact: false }), { target: { value: '{"数量":0,"成功":false,"备注":"","其他":null}' } });
  await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "检查并保存核对结论" })); await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
}
async function inspect(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole("button", { name: "核对最新记录" })); }
async function expectUnknown() {
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("仍不能确认本次提交"));
  expect(screen.queryByText(/已在最新历史中找到本次核对记录/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled(); expect(submit).toHaveBeenCalledOnce(); expect(crypto.randomUUID).toHaveBeenCalledOnce();
}

describe("核对历史必须匹配完整固定请求摘要", () => {
  it("同操作标识与同摘要但返回其他任务，在父回调和摘要计算前拒绝确认", async () => {
    const user = userEvent.setup(); const { lock, observed } = setup(); await send(user);
    const digest = vi.spyOn(webcrypto.subtle, "digest");
    read.mockResolvedValue({ ok: true, operation: { ...operation, sourceRunId: "55555555-5555-4555-8555-555555555555", status: "completed", resolutions: [makeRecord()] } });
    await inspect(user); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("所属任务不一致"));
    expect(digest).not.toHaveBeenCalled(); expect(observed).not.toHaveBeenCalled(); expect(lock).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText(/已在最新历史中找到本次核对记录/)).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled(); expect(submit).toHaveBeenCalledOnce();
  });
  it.each(["reason", "receipt"])("同标识同结论但%s内容摘要不同，继续未知并禁重发", async (changed) => {
    const user = userEvent.setup(); const { lock } = setup(); await send(user);
    const input = ToolOperationResolveInput.parse(changed === "reason" ? { ...fixedPayload(), reason: "已查询另一份记录 密钥: abcdef1234567890" } : { ...fixedPayload(), receipt: { 数量: 99, 成功: false } });
    const record = makeRecord(input); expect(record.requestId).toBe(requestId); expect(record.kind).toBe(fixedPayload().kind);
    read.mockResolvedValue({ ok: true, operation: { ...operation, status: "pending", resolutions: [record] } }); await inspect(user); await expectUnknown(); expect(lock).toHaveBeenLastCalledWith(true);
  });
  it.each(["record-receipt", "retry"] as const)("真正匹配的%s完整摘要确认登记，脱敏原因不会替代原请求", async (kind) => {
    const user = userEvent.setup(); const { lock, observed, container } = setup(); await send(user, kind);
    const record = makeRecord(); expect(record.reason).not.toBe(fixedPayload().reason);
    read.mockResolvedValue({ ok: true, operation: { ...operation, status: kind === "retry" ? "pending" : "completed", resolutions: [record] } }); await inspect(user);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已在最新历史中找到本次核对记录"));
    expect(observed).toHaveBeenCalledOnce(); expect(lock).toHaveBeenLastCalledWith(false); expect(submit).toHaveBeenCalledOnce(); expect(container.textContent).not.toContain(record.requestHash); expect(container.textContent).not.toContain(requestId);
  });
  it("记录缺少摘要即使标识与结论相同也不确认登记", async () => {
    const user = userEvent.setup(); setup(); await send(user); const record = { ...makeRecord(), requestHash: undefined };
    read.mockResolvedValue({ ok: true, operation: { ...operation, resolutions: [record] } as unknown as ToolOperationView }); await inspect(user); await expectUnknown();
  });
  it("非安全浏览器有完整记录仍保留未知，不换请求或重发", async () => {
    const user = userEvent.setup(); setup(); await send(user); read.mockResolvedValue({ ok: true, operation: { ...operation, resolutions: [makeRecord()] } }); vi.stubGlobal("isSecureContext", false);
    await inspect(user); await expectUnknown();
  });
  it("缺少浏览器摘要能力且尚无记录时，不能通过空历史放行重发", async () => {
    const user = userEvent.setup(); setup(); await send(user); read.mockResolvedValue({ ok: true, operation }); vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValue(requestId) });
    await inspect(user); await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("仍不能确认本次提交")); expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled(); expect(submit).toHaveBeenCalledOnce();
  });
  it("摘要计算拒绝保留未知，不把能力错误当业务未执行", async () => {
    const user = userEvent.setup(); setup(); await send(user); read.mockResolvedValue({ ok: true, operation: { ...operation, resolutions: [makeRecord()] } }); vi.spyOn(webcrypto.subtle, "digest").mockRejectedValue(new Error("计算被拒绝"));
    await inspect(user); await expectUnknown();
  });
  it("摘要等待期间禁止重复读取，卸载后迟到摘要不回调父组件", async () => {
    let finish!: (result: ArrayBuffer) => void;
    const digest = vi.spyOn(webcrypto.subtle, "digest").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); const { unmount, lock, observed } = setup(); await send(user); read.mockResolvedValue({ ok: true, operation: { ...operation, resolutions: [makeRecord()] } }); await inspect(user);
    await waitFor(() => expect(digest).toHaveBeenCalledOnce()); expect(screen.getByRole("button", { name: "核对最新记录" })).toBeDisabled(); expect(observed).not.toHaveBeenCalled();
    const beforeCalls = lock.mock.calls.length; const bytes = Uint8Array.from(createHash("sha256").update(canonicalJson(fixedPayload())).digest());
    unmount(); await act(async () => finish(bytes.buffer)); expect(lock).toHaveBeenCalledTimes(beforeCalls); expect(observed).not.toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce(); expect(submit).toHaveBeenCalledOnce();
  });
  it("卸载后迟到读取不继续计算摘要，不声称网络取消撤销业务", async () => {
    let finish!: (result: ToolOperationGetResult) => void; read.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const digest = vi.spyOn(webcrypto.subtle, "digest"); const user = userEvent.setup(); const { unmount, lock, observed } = setup(); await send(user); await inspect(user); const beforeCalls = lock.mock.calls.length; const result: ToolOperationGetResult = { ok: true, operation: { ...operation, resolutions: [makeRecord()] } };
    unmount(); await act(async () => finish(result)); expect(digest).not.toHaveBeenCalled(); expect(observed).not.toHaveBeenCalled(); expect(lock).toHaveBeenCalledTimes(beforeCalls); expect(submit).toHaveBeenCalledOnce();
  });
});
