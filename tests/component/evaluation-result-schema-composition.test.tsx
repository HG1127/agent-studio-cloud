import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationActionResult, EvaluationCaseView, EvaluationGenerateResult } from "@/contracts/evaluation";
import { EvaluationPanel } from "@/features/agents/EvaluationPanel";
import { evaluationRequestRecoveryKey } from "@/features/quality/evaluation-request-recovery";

const { create, update, generate, archive, start, refresh } = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), generate: vi.fn(), archive: vi.fn(), start: vi.fn(), refresh: vi.fn(),
}));
vi.mock("@/server/actions/evaluations", () => ({
  createEvaluationCaseAction: create, updateEvaluationCaseAction: update,
  generateEvaluationCasesAction: generate, setEvaluationCaseArchivedAction: archive, startEvaluationAction: start,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, replace: vi.fn() }) }));

const agentId = "00000000-0000-4000-8000-000000000301";
const caseId = "00000000-0000-4000-8000-000000000302";
const updatedAt = "2026-10-01T01:00:00.000Z";
const rule = { type: "object", properties: { amount: { type: "number", minimum: 0 }, approved: { const: false } }, required: ["amount"] };
const replacement = { ...rule, additionalProperties: false };
function sample(value: unknown = rule, supplied = true): EvaluationCaseView {
  return {
    id: caseId, name: "续约样例", input: { input: "原始输入", count: 0, approved: false },
    expectations: [{ path: "", operator: "contains", value: "原预期" }, { path: "amount", operator: "equals", value: 0 }],
    createdAt: updatedAt, updatedAt, ...(supplied ? { resultSchema: value } : {}),
  } as EvaluationCaseView;
}
function deferred<T = EvaluationActionResult>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function CommitReceipt({ deliver }: { deliver: () => void }) {
  useLayoutEffect(deliver, [deliver]);
  return null;
}
function edit() { fireEvent.click(screen.getByRole("button", { name: "编辑" })); }
function openRule() { fireEvent.click(screen.getByRole("button", { name: "编辑结果结构规则" })); }
function fillRule(value: unknown) {
  openRule();
  fireEvent.change(screen.getByLabelText("结果结构规则（开发者格式）"), { target: { value: JSON.stringify(value) } });
}
function confirmClear() {
  fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认清除结构规则" }));
}
function save() { fireEvent.click(screen.getByRole("button", { name: "保存修改" })); }

beforeEach(() => {
  for (const mock of [create, update, generate, archive, start, refresh]) mock.mockReset();
  sessionStorage.clear();
  create.mockResolvedValue({ ok: true }); update.mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());

describe("真实验收父组件的结果结构规则保存边界", () => {
  it.each([{ value: undefined, supplied: false }, { value: null, supplied: true }, { value: rule, supplied: true }, { value: [], supplied: true }])("来源$value保持原规则：省略字段且保留字段检查", async ({ value, supplied }) => {
    const original = sample(value, supplied), before = JSON.stringify(original);
    render(<EvaluationPanel agentId={agentId} cases={[original]} runs={[]} />);
    edit(); openRule();
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "只改名称" } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    const payload = update.mock.calls[0][0];
    expect(Object.hasOwn(payload, "resultSchema")).toBe(false);
    expect(payload).toMatchObject({ caseId, expectedUpdatedAt: updatedAt, name: "只改名称", input: original.input });
    expect(payload.expectations).toEqual([original.expectations[1], original.expectations[0]]);
    expect(JSON.stringify(original)).toBe(before);
    expect(create).not.toHaveBeenCalled();
  });

  it("新样例打开规则为空，未填写时不生成或提交示例规则", async () => {
    render(<EvaluationPanel agentId={agentId} cases={[]} runs={[]} />);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "新样例" } });
    openRule();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "添加样例" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(Object.hasOwn(create.mock.calls[0][0], "resultSchema")).toBe(false);
  });

  it.each(["clear", "replace"] as const)("明确%s真实更新载荷；其他填写和零值不丢失", async (operation) => {
    render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit();
    if (operation === "clear") confirmClear(); else fillRule(replacement);
    save();
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0]).toEqual({
      agentId, caseId, expectedUpdatedAt: updatedAt, name: "续约样例",
      input: { input: "原始输入", count: 0, approved: false },
      expectations: [{ path: "amount", operator: "equals", value: 0 }, { path: "", operator: "contains", value: "原预期" }],
      resultSchema: operation === "clear" ? null : replacement,
    });
  });

  it("新建合法对象通过真实create入口，成功状态只确认保存", async () => {
    const pending = deferred(); create.mockReturnValue(pending.promise);
    render(<EvaluationPanel agentId={agentId} cases={[]} runs={[]} />);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "结构样例" } });
    fillRule(replacement);
    expect(screen.getByText(/本页规则填写尚未保存/)).toHaveTextContent("不代表规则有效或验收通过");
    fireEvent.click(screen.getByRole("button", { name: "添加样例" }));
    expect(create.mock.calls[0][0].resultSchema).toEqual(replacement);
    expect(screen.getByRole("status", { name: "样例保存状态" })).toHaveTextContent("正在保存");
    expect(screen.queryByText(/验收样例已保存/)).not.toBeInTheDocument();
    await act(async () => { pending.resolve({ ok: true }); await pending.promise; });
    expect(screen.getByRole("status")).toHaveTextContent("保存规则不代表验收通过");
    expect(screen.getByLabelText("样例名称")).toHaveValue("");
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["{", "null", "[]", '{"type":"array"}'])("非法规则%s保留全部草稿而且不触发动作", (text) => {
    render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); openRule();
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "未保存名称" } });
    fireEvent.change(screen.getByLabelText("结果结构规则（开发者格式）"), { target: { value: text } });
    save();
    expect(screen.getByRole("alert")).toHaveTextContent("结果结构规则");
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue(text);
    expect(screen.getByLabelText("样例名称")).toHaveValue("未保存名称");
    expect(update).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it.each(["验收样例已在其他页面发生变化；你的修改仍保留在本页，请刷新核对后再保存", "验收结果字段规则使用了暂不支持的规则"])("后端返回%s时规则、输入和预期全部保留", async (error) => {
    update.mockResolvedValue({ ok: false, error });
    render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); fillRule({ type: "object", oneOf: [] });
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "冲突填写" } });
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: '{"input":"新填写"}' } });
    fireEvent.change(screen.getByLabelText("结果应包含"), { target: { value: "新预期" } });
    save();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(error));
    expect(update.mock.calls[0][0].resultSchema).toEqual({ type: "object", oneOf: [] });
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue('{"type":"object","oneOf":[]}');
    expect(screen.getByLabelText("运行输入")).toHaveValue('{"input":"新填写"}');
    expect(screen.getByLabelText("样例名称")).toHaveValue("冲突填写");
    expect(screen.getByLabelText("结果应包含")).toHaveValue("新预期");
    expect(screen.getByLabelText("样例名称")).toBeEnabled();
    expect(screen.getByLabelText("运行输入")).toBeEnabled();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeEnabled();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "核对上次保存" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "首次失败后继续填写" } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1][0]).not.toBe(update.mock.calls[0][0]);
    expect(update.mock.calls[1][0]).toMatchObject({ name: "首次失败后继续填写", expectedUpdatedAt: updatedAt, input: { input: "新填写" }, resultSchema: { type: "object", oneOf: [] } });
    expect(screen.queryByText(/验收样例已保存/)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("取消只恢复规则；名称、输入、字段检查继续提交", async () => {
    render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); fillRule(replacement);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "保留填写" } });
    fireEvent.change(screen.getByLabelText("运行输入"), { target: { value: '{"input":"保留输入"}' } });
    fireEvent.change(screen.getByLabelText("字段检查 1 预期值"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "取消规则填写" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认取消规则填写" }));
    save();
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0]).toMatchObject({ name: "保留填写", input: { input: "保留输入" }, expectations: [{ path: "amount", operator: "equals", value: false }, { path: "", operator: "contains", value: "原预期" }] });
    expect(Object.hasOwn(update.mock.calls[0][0], "resultSchema")).toBe(false);
  });

  it("同批重复保存只发送一次；实际处理入口阻止随后改变规则和名称", async () => {
    const pending = deferred(); update.mockReturnValue(pending.promise);
    render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); fillRule(replacement);
    const button = screen.getByRole("button", { name: "保存修改" });
    const text = screen.getByLabelText("结果结构规则（开发者格式）");
    const name = screen.getByLabelText("样例名称");
    act(() => {
      fireEvent.click(button); fireEvent.click(button);
      fireEvent.change(name, { target: { value: "同批后来名称" } });
      fireEvent.change(text, { target: { value: '{"type":"object","description":"同批后来规则"}' } });
    });
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0][0]).toMatchObject({ name: "续约样例", resultSchema: replacement });
    await act(async () => { pending.resolve({ ok: false, error: "暂未保存，请核对" }); await pending.promise; });
    expect(screen.getByLabelText("样例名称")).toHaveValue("续约样例");
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue(JSON.stringify(replacement));
  });

  it.each(["create", "update"] as const)("丢失%s回执后核对同一原载荷，不采后来草稿或刷新后的版本", async (kind) => {
    const action = kind === "create" ? create : update;
    const retry = deferred();
    action.mockRejectedValueOnce(new Error("lost receipt"))
      .mockResolvedValueOnce({ ok: false, error: "版本冲突，填写仍保留" })
      .mockReturnValueOnce(retry.promise);
    const original = sample();
    const view = render(<EvaluationPanel agentId={agentId} cases={kind === "update" ? [original] : []} runs={[]} />);
    if (kind === "update") edit(); else fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "新结构样例" } });
    fillRule(replacement);
    fireEvent.click(screen.getByRole("button", { name: kind === "update" ? "保存修改" : "添加样例" }));
    await screen.findByRole("status", { name: "样例保存状态" });
    await waitFor(() => expect(screen.getByRole("button", { name: "核对上次保存" })).toBeEnabled());
    const originalPayload = action.mock.calls[0][0];
    view.rerender(<EvaluationPanel agentId={agentId} cases={[{ ...original, updatedAt: "2026-10-02T01:00:00.000Z", resultSchema: null }]} runs={[]} />);
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "后来名称" } });
    fireEvent.change(screen.getByLabelText("结果结构规则（开发者格式）"), { target: { value: '{"type":"object","description":"后来规则"}' } });
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核对上次保存" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    expect(action.mock.calls[1][0]).toBe(originalPayload);
    if (kind === "update") expect(action.mock.calls[1][0].expectedUpdatedAt).toBe(updatedAt);
    await waitFor(() => expect(screen.getByText(/本次核对仍无法确认上次是否保存成功/)).toHaveTextContent("版本冲突"));
    const saveError = screen.getByText(/本次核对仍无法确认上次是否保存成功/);
    expect(saveError).toHaveAttribute("role", "alert");
    expect(saveError).toBeVisible();
    expect(saveError).toHaveTextContent("请先核对已保存的样例记录");
    expect(within(screen.getByRole("region", { name: "验收结果结构规则" })).getByRole("alert")).toHaveTextContent("本次操作未接收");
    expect(screen.getByRole("status", { name: "样例保存状态" })).toHaveTextContent("上次样例保存结果待核对");
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue(JSON.stringify(replacement));
    expect(screen.getByLabelText("样例名称")).toHaveValue(kind === "update" ? "续约样例" : "新结构样例");
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.getByLabelText("运行输入")).toBeDisabled();
    expect(screen.getByLabelText("结果应包含")).toBeDisabled();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeDisabled();
    const lockedName = screen.getByLabelText("样例名称");
    const originalDisabled = lockedName.getAttribute("disabled");
    expect(originalDisabled).not.toBeNull();
    try {
      lockedName.removeAttribute("disabled");
      fireEvent.change(lockedName, { target: { value: "失败核对后另写的名称" } });
      expect(lockedName).toHaveValue(kind === "update" ? "续约样例" : "新结构样例");
    } finally {
      if (originalDisabled !== null) lockedName.setAttribute("disabled", originalDisabled);
    }
    fireEvent.click(screen.getByRole("button", { name: "核对上次保存" }));
    expect(action).toHaveBeenCalledTimes(3);
    expect(action.mock.calls[2][0]).toBe(originalPayload);
    if (kind === "update") expect(action.mock.calls[2][0].expectedUpdatedAt).toBe(updatedAt);
    expect(screen.getByRole("status", { name: "样例保存状态" })).toHaveTextContent("正在保存");
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
    await act(async () => { retry.resolve({ ok: false, error: "再次核对仍失败" }); await retry.promise; });
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeDisabled();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue(JSON.stringify(replacement));
    expect(screen.getByRole("status", { name: "样例保存状态" })).toHaveTextContent("上次样例保存结果待核对");
    expect(screen.getByRole("button", { name: "编辑" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "运行全部样例" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对上次保存" })).toBeEnabled();
    expect(screen.queryByText(/验收样例已保存/)).not.toBeInTheDocument();
  });

  it("规则A到B再回A使同批旧清除确认失效", () => {
    render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); openRule();
    fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
    const confirmation = within(screen.getByRole("dialog")).getByRole("button", { name: "确认清除结构规则" });
    const text = screen.getByLabelText("结果结构规则（开发者格式）");
    act(() => {
      fireEvent.change(text, { target: { value: JSON.stringify(replacement) } });
      fireEvent.change(text, { target: { value: JSON.stringify(rule, null, 2) } });
      fireEvent.click(confirmation);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("本次操作未接收");
    expect(screen.queryByText(/本次保存将明确清除/)).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("切换样例A到B再回A或重置同样例不能复活旧确认", () => {
    const second = { ...sample(null), id: "00000000-0000-4000-8000-000000000303", name: "另一条样例" };
    render(<EvaluationPanel agentId={agentId} cases={[sample(), second]} runs={[]} />);
    const firstRow = screen.getByRole("listitem", { name: "验收样例：续约样例" });
    const secondRow = screen.getByRole("listitem", { name: "验收样例：另一条样例" });
    const firstEdit = within(firstRow).getByRole("button", { name: "编辑" });
    const secondEdit = within(secondRow).getByRole("button", { name: "编辑" });
    fireEvent.click(firstEdit);
    fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
    const oldConfirm = within(screen.getByRole("dialog")).getByRole("button", { name: "确认清除结构规则" });
    act(() => {
      fireEvent.click(secondEdit);
      fireEvent.click(firstEdit);
      fireEvent.click(oldConfirm);
    });
    expect(screen.getByLabelText("样例名称")).toHaveValue("续约样例");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/本次保存将明确清除/)).not.toBeInTheDocument();
    const cancelEditing = screen.getByRole("button", { name: "取消编辑" });
    fireEvent.click(screen.getByRole("button", { name: "明确清除结构规则" }));
    fireEvent.click(cancelEditing);
    fireEvent.click(firstEdit);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("实际验收运行和未知启动回执锁定规则及保存处理入口", async () => {
    const versionId = "00000000-0000-4000-8000-000000000304";
    start.mockRejectedValue(new Error("lost start receipt"));
    const view = render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} evaluationVersionId={versionId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled());
    edit(); fillRule(replacement);
    fireEvent.click(screen.getByRole("button", { name: "运行全部样例" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("暂时无法确认验收"));
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeDisabled();
    const button = screen.getByRole("button", { name: "保存修改" });
    button.removeAttribute("disabled"); fireEvent.click(button);
    expect(update).not.toHaveBeenCalled();
    view.rerender(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} evaluationRunning />);
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeDisabled();
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
  });

  it.each((["create", "update", "start", "generate", "archive", "restore"] as const).flatMap((operation) =>
    (["success", "failure", "unknown"] as const).map((receipt) => ({ operation, receipt })),
  ))("助手A到B再回A隔离旧$operation的$receipt回执", async ({ operation, receipt }) => {
    const pending = deferred<EvaluationActionResult | EvaluationGenerateResult>();
    const action = { create, update, start, generate, archive, restore: archive }[operation];
    action.mockReturnValue(pending.promise);
    const view = render(<EvaluationPanel agentId={agentId} cases={operation === "generate" ? [] : [sample()]} archivedCases={operation === "restore" ? [sample(null)] : []} runs={[]} />);
    if (operation === "create") {
      fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "旧会话新样例" } });
      fillRule(replacement);
      fireEvent.click(screen.getByRole("button", { name: "添加样例" }));
    } else if (operation === "update") {
      edit(); fillRule(replacement); save();
    } else if (operation === "start") {
      fireEvent.click(screen.getByRole("button", { name: "运行全部样例" }));
    } else if (operation === "generate") {
      fireEvent.click(screen.getByRole("button", { name: "从流程生成样例" }));
    } else if (operation === "archive") {
      fireEvent.click(screen.getByRole("button", { name: "归档" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "归档样例" }));
    } else {
      fireEvent.click(screen.getByText("已归档样例（第 1 页）"));
      fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    }
    expect(action).toHaveBeenCalledOnce();
    const otherAgent = "00000000-0000-4000-8000-000000000305";
    view.rerender(<EvaluationPanel agentId={otherAgent} cases={[sample(null)]} runs={[]} />);
    expect(screen.getByLabelText("样例名称")).toHaveValue("");
    view.rerender(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); fillRule({ type: "object", description: "新会话填写" });
    fireEvent.change(screen.getByLabelText("样例名称"), { target: { value: "新会话名称" } });
    await act(async () => {
      if (receipt === "unknown") pending.reject(new Error("lost old owner receipt"));
      else pending.resolve(receipt === "failure" ? { ok: false, error: "旧会话动作错误" } : operation === "generate" ? { ok: true, createdCount: 2 } : { ok: true });
      await pending.promise.catch(() => undefined);
    });
    expect(screen.getByLabelText("样例名称")).toHaveValue("新会话名称");
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toHaveValue('{"type":"object","description":"新会话填写"}');
    expect(screen.getByLabelText("样例名称")).toBeEnabled();
    expect(screen.getByLabelText("结果结构规则（开发者格式）")).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "样例保存状态" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对上次保存" })).not.toBeInTheDocument();
    expect(screen.queryByText(/验收样例已保存/)).not.toBeInTheDocument();
    expect(action).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
  });

  it("切换提交的布局阶段到达旧保存回执，也不能刷新当前助手", async () => {
    const pending = deferred(); update.mockReturnValue(pending.promise);
    const view = render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} />);
    edit(); fillRule(replacement); save();
    view.rerender(<><EvaluationPanel agentId="00000000-0000-4000-8000-000000000305" cases={[sample(null)]} runs={[]} /><CommitReceipt deliver={() => pending.resolve({ ok: true })} /></>);
    await act(async () => { await pending.promise; });
    expect(screen.getByLabelText("样例名称")).toHaveValue("");
    expect(screen.queryByText(/验收样例已保存/)).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["success", "failure", "unknown"] as const)("旧启动的%s回执不能删除回到A后正在核对的线索或解除处理中状态", async (receipt) => {
    const oldRequest = deferred(), currentRequest = deferred();
    start.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(currentRequest.promise);
    const versionId = "00000000-0000-4000-8000-000000000304";
    const view = render(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} evaluationVersionId={versionId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "运行全部样例" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "运行全部样例" }));
    const recoveryKey = evaluationRequestRecoveryKey(agentId);
    const originalClue = sessionStorage.getItem(recoveryKey);
    expect(originalClue).not.toBeNull();
    expect(JSON.parse(originalClue!)).toEqual({ requestId: start.mock.calls[0][1], versionId });
    view.rerender(<EvaluationPanel agentId="00000000-0000-4000-8000-000000000305" cases={[sample(null)]} runs={[]} />);
    view.rerender(<EvaluationPanel agentId={agentId} cases={[sample()]} runs={[]} evaluationVersionId={versionId} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "核对上次验收" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "核对上次验收" }));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start.mock.calls[1]).toEqual(start.mock.calls[0]);
    await act(async () => {
      if (receipt === "unknown") oldRequest.reject(new Error("lost old start receipt"));
      else oldRequest.resolve(receipt === "success" ? { ok: true } : { ok: false, error: "旧启动错误" });
      await oldRequest.promise.catch(() => undefined);
    });
    expect(sessionStorage.getItem(recoveryKey)).toBe(originalClue);
    expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
    expect(screen.getByLabelText("样例名称")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    await act(async () => { currentRequest.resolve({ ok: true }); await currentRequest.promise; });
    expect(refresh).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(recoveryKey)).toBeNull();
  });

  it("只有结构规则的样例显示实际结构检查，查看不执行保存或验收", () => {
    const source = { ...sample(), expectations: [] }, before = JSON.stringify(source);
    render(<EvaluationPanel agentId={agentId} cases={[source]} runs={[]} />);
    const row = screen.getByRole("listitem", { name: "验收样例：续约样例" });
    fireEvent.click(within(row).getByText("查看样例内容"));
    expect(row).toHaveTextContent("检查结果结构");
    expect(row).not.toHaveTextContent("只检查流程是否成功完成");
    expect(row).not.toHaveTextContent("规则通过");
    expect(JSON.stringify(source)).toBe(before);
    expect(create).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
  });
});
