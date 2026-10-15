import Link from "next/link";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessWorkspace } from "@/features/harness/HarnessWorkspace";
import { RuntimeDefaultsDraft, RuleConditionsDraft } from "@/features/harness/RuntimeDefaultsDraft";
import { DraftNavigationGuard } from "@/features/workflow-canvas/DraftNavigationGuard";
import { DRAFT_STATE_EVENT, notifyDraftState, type DraftStateDetail } from "@/lib/draft-state";
import { RunSummary } from "@/contracts/run";
import { HarnessPolicyReadResult } from "@/contracts/harness-management";
import { HarnessNavigation } from "@/features/harness/harness-navigation";

const emptyPolicy = HarnessPolicyReadResult.parse({ ok: true, policy: { revision: 0, source: "unconfigured", policy: null, updatedAt: null } });
const network = vi.fn();
const releaseListeners: (() => void)[] = [];
function preventDocumentNavigationOnce() {
  const prevent = (event: Event) => event.preventDefault();
  document.addEventListener("click", prevent, { once: true });
  releaseListeners.push(() => document.removeEventListener("click", prevent));
}
function watchDrafts() {
  const changes: DraftStateDetail[] = [];
  const receive = (event: Event) => { changes.push((event as CustomEvent<DraftStateDetail>).detail); };
  window.addEventListener(DRAFT_STATE_EVENT, receive);
  releaseListeners.push(() => window.removeEventListener(DRAFT_STATE_EVENT, receive));
  return changes;
}
function fillRuntime() {
  for (const [label, value] of [
    ["步骤失败时怎么处理", "safe_default"], ["怎样检查交付结果", "contract_safety"],
    ["拦截疑似敏感内容", "yes"], ["失败任务始终评估", "yes"],
    ["涉及人工确认的任务始终评估", "yes"], ["未通过评估的任务加入回归候选", "no"],
  ]) fireEvent.change(screen.getByRole("combobox", { name: label }), { target: { value } });
  for (const [label, value] of [["每次最多参考多少条记忆", "5"], ["记忆内容上限（字符）", "4000"], ["常规任务抽查比例（%）", "50"]]) {
    fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
  }
  const advanced = screen.getByText("高级设置：计划与上下文容量").closest("details");
  if (!advanced) throw new Error("缺少计划容量分区");
  advanced.open = true;
  fireEvent.change(screen.getByRole("combobox", { name: "如何生成执行计划" }), { target: { value: "workflow_static" } });
  fireEvent.change(screen.getByRole("textbox", { name: "上下文上限（字符）" }), { target: { value: "12000" } });
}
function SlotEditor({ label }: { label: string }) {
  const [value, setValue] = useState("");
  return <label>{label}<input value={value} onChange={(event) => setValue(event.target.value)} /></label>;
}
function workspace(runs: RunSummary[] | null = [], policy: HarnessPolicyReadResult = emptyPolicy) {
  return <HarnessWorkspace runs={runs} policy={policy} diagnostics={<h2>真实诊断区域</h2>} rules={<SlotEditor label="已有安全规则填写" />} resources={<SlotEditor label="已有资源填写" />} />;
}

describe("V5.7 Harness 网页端分区与明确本地草稿", () => {
  beforeEach(() => { vi.restoreAllMocks(); network.mockReset(); vi.stubGlobal("fetch", network); });
  afterEach(() => { for (const release of releaseListeners.splice(0)) release(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("默认打开诊断，未知不当零；最近范围和附加规则计数来自共享契约", () => {
    const view = render(workspace(null, { ok: false, error: "private-read-failure" }));
    expect(screen.getByRole("tab", { name: "运行诊断" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "真实诊断区域" })).toBeVisible();
    expect(screen.getAllByText("暂未知")).toHaveLength(3);
    expect(screen.queryByText("private-read-failure")).not.toBeInTheDocument();
    expect(screen.getByText(/不是全部历史数量/)).toBeInTheDocument();
    const runs = ["failed", "waiting_approval", "waiting_event", "completed"].map((status) => RunSummary.parse({ id: "00000000-0000-4000-8000-000000000081", agentId: "00000000-0000-4000-8000-000000000082", agentName: "助手", status, startedAt: null, finishedAt: null }));
    view.rerender(workspace(runs));
    const overview = screen.getByRole("region", { name: "运行概况" });
    expect(within(overview).getByText("4")).toBeInTheDocument();
    expect(within(overview).getByText("3")).toBeInTheDocument();
    expect(within(overview).getByText("0")).toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
  });

  it("键盘切分区且所有面板保持挂载，草稿和真实接口区域的填写互不丢失", async () => {
    const user = userEvent.setup(); const view = render(workspace());
    const diagnostics = screen.getByRole("tab", { name: "运行诊断" });
    diagnostics.focus(); await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "默认运行规则" })).toHaveFocus();
    await user.selectOptions(screen.getByRole("combobox", { name: "步骤失败时怎么处理" }), "human_first");
    await user.click(screen.getByRole("tab", { name: "安全规则" }));
    await user.type(screen.getByRole("textbox", { name: "已有安全规则填写" }), "保留真实规则草稿");
    await user.click(screen.getByRole("tab", { name: "资源限额" }));
    await user.type(screen.getByRole("textbox", { name: "已有资源填写" }), "保留限额填写");
    view.rerender(workspace(null));
    expect(screen.getByRole("textbox", { name: "已有资源填写" })).toHaveValue("保留限额填写");
    await user.click(screen.getByRole("tab", { name: "安全规则" }));
    expect(screen.getByRole("textbox", { name: "已有安全规则填写" })).toHaveValue("保留真实规则草稿");
    await user.click(screen.getByRole("tab", { name: "默认运行规则" }));
    expect(screen.getByRole("combobox", { name: "步骤失败时怎么处理" })).toHaveValue("human_first");
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(4);
    expect(network).not.toHaveBeenCalled();
  });

  it("待处理入口保留所选任务及诊断范围，切回诊断但不丢分区填写", async () => {
    const user = userEvent.setup();
    const navigation = HarnessNavigation.parse({
      runId: "00000000-0000-4000-8000-000000000081",
      list: { query: "业务 助手", attention: false },
      trace: { query: "失败", nodeId: "review", attention: true, range: "history", page: 2 },
      context: { page: 3, query: "上游结果" },
    });
    render(<HarnessWorkspace runs={[]} policy={emptyPolicy} navigation={navigation}
      diagnostics={<h2>真实诊断区域</h2>} rules={<SlotEditor label="已有安全规则填写" />} resources={<SlotEditor label="已有资源填写" />} />);
    await user.click(screen.getByRole("tab", { name: "安全规则" }));
    await user.type(screen.getByRole("textbox", { name: "已有安全规则填写" }), "保留规则填写");
    const entry = screen.getByRole("link", { name: /最近待处理/ });
    const destination = new URL(entry.getAttribute("href") ?? "", "https://example.invalid");
    expect(destination.pathname).toBe("/harness");
    expect(destination.hash).toBe("#diagnostic-runs-title");
    expect(Object.fromEntries(destination.searchParams)).toEqual({ run: navigation.runId, runQuery: "业务 助手", runAttention: "1",
      traceQuery: "失败", traceNode: "review", traceAttention: "1", traceRange: "history", tracePage: "2", contextPage: "3", contextQuery: "上游结果" });
    preventDocumentNavigationOnce();
    await user.click(entry);
    expect(screen.getByRole("tab", { name: "运行诊断" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "安全规则" }));
    expect(screen.getByRole("textbox", { name: "已有安全规则填写" })).toHaveValue("保留规则填写");
    expect(network).not.toHaveBeenCalled();
  });

  it("新标签点击待处理入口不改变当前分区；取消草稿离页保持原填写", async () => {
    const user = userEvent.setup();
    render(<><DraftNavigationGuard />{workspace()}</>);
    await user.click(screen.getByRole("tab", { name: "默认运行规则" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "步骤失败时怎么处理" }), "human_first");
    const entry = screen.getByRole("link", { name: /最近待处理/ });
    preventDocumentNavigationOnce();
    fireEvent.click(entry, { ctrlKey: true });
    expect(screen.getByRole("tab", { name: "默认运行规则" })).toHaveAttribute("aria-selected", "true");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(entry);
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "默认运行规则" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox", { name: "步骤失败时怎么处理" })).toHaveValue("human_first");
    expect(entry).toHaveAttribute("href", "/harness?runAttention=1#diagnostic-runs-title");
    expect(network).not.toHaveBeenCalled();
  });

  it("初始规则没有假默认值，本地检查定位首个错误并关联内联提示", async () => {
    render(<RuntimeDefaultsDraft />); const user = userEvent.setup();
    expect(screen.getByRole("combobox", { name: "步骤失败时怎么处理" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "每次最多参考多少条记忆" })).toHaveValue("");
    expect(screen.queryByRole("button", { name: "保存默认规则" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const first = screen.getByRole("combobox", { name: "步骤失败时怎么处理" });
    expect(first).toHaveFocus(); expect(first).toHaveAttribute("aria-invalid", "true");
    expect(first).toHaveAccessibleDescription(/请选择失败处理方式/);
    expect(screen.getByRole("alert")).toHaveTextContent("尚未保存或生效");
    expect(network).not.toHaveBeenCalled();
  });

  it("高级容量有错时打开高级分区并聚焦，不给无效容量通过反馈", async () => {
    render(<RuntimeDefaultsDraft />); fillRuntime();
    const capacity = screen.getByRole("textbox", { name: "上下文上限（字符）" });
    fireEvent.change(capacity, { target: { value: "60001" } });
    const details = capacity.closest("details"); if (!details) throw new Error("缺少高级分区"); details.open = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "检查草稿" }));
    expect(details.open).toBe(true); expect(capacity).toHaveFocus();
    expect(capacity).toHaveAccessibleDescription(/2,000–60,000/);
    expect(screen.getByText("上下文容量：填写待检查")).toBeInTheDocument();
    expect(screen.queryByText(/本地草稿检查通过/)).not.toBeInTheDocument();
  });

  it("检查成功仍保护未保存草稿，不写网络或本地持久存储", async () => {
    const changes = watchDrafts(); const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<RuntimeDefaultsDraft />); fillRuntime();
    await userEvent.setup().click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("未保存，也未改变任何运行");
    expect(changes.at(-1)?.dirty).toBe(true);
    const leave = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(leave)).toBe(false);
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it("撤销需确认，取消保持填写和焦点，确认只回到本页检查快照", async () => {
    render(<RuntimeDefaultsDraft />); fillRuntime(); const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const rate = screen.getByRole("textbox", { name: "常规任务抽查比例（%）" });
    fireEvent.change(rate, { target: { value: "75" } });
    const undo = screen.getByRole("button", { name: "撤销修改" }); await user.click(undo);
    expect(screen.getByRole("dialog")).toHaveTextContent("本页上次检查");
    await user.keyboard("{Escape}"); expect(rate).toHaveValue("75"); expect(undo).toHaveFocus();
    await user.click(undo); await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(rate).toHaveValue("50");
    expect(screen.getByRole("status")).toHaveTextContent("系统配置没有变化");
    expect(screen.getByRole("button", { name: "检查草稿" })).toHaveFocus();
    expect(network).not.toHaveBeenCalled();
  });

  it("清空取消不丢填写，确认清空与卸载只释放自己的草稿标记", async () => {
    const changes = watchDrafts(); const view = render(<RuntimeDefaultsDraft />); const user = userEvent.setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "步骤失败时怎么处理" }), "resilient");
    const ownKey = changes.at(-1)?.agentId; expect(ownKey).toMatch(/^harness-runtime-defaults-draft:/);
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("combobox", { name: "步骤失败时怎么处理" })).toHaveValue("resilient");
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(screen.getByRole("button", { name: "确认清空草稿" }));
    expect(screen.getByRole("combobox", { name: "步骤失败时怎么处理" })).toHaveValue("");
    expect(changes.at(-1)).toEqual({ agentId: ownKey, dirty: false });
    view.unmount(); expect(changes.at(-1)).toEqual({ agentId: ownKey, dirty: false });
    expect(changes.every((detail) => detail.agentId === ownKey)).toBe(true);
  });

  it("自有草稿卸载不清除其他真实规则的离页保护", () => {
    render(<><DraftNavigationGuard /><Link href="/runs" prefetch={false}>返回处理记录</Link></>);
    const local = render(<RuntimeDefaultsDraft />);
    fireEvent.change(screen.getByRole("combobox", { name: "步骤失败时怎么处理" }), { target: { value: "human_first" } });
    act(() => notifyDraftState({ agentId: "existing-server-policy-draft", dirty: true }));
    local.unmount(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(fireEvent.click(screen.getByRole("link", { name: "返回处理记录" }))).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("其他规则效果和身份环境可选择、检查，但不伪造审批或运行判决", async () => {
    const changes = watchDrafts(); render(<RuleConditionsDraft />); const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "草稿规则名称" }), "外部操作先确认");
    await user.selectOptions(screen.getByRole("combobox", { name: "设计中的步骤范围" }), "tool");
    await user.selectOptions(screen.getByRole("combobox", { name: "设计中的处理方式" }), "require_approval");
    await user.click(screen.getByRole("button", { name: "检查规则设计" }));
    const role = screen.getByRole("combobox", { name: "待模拟身份" });
    expect(role).toHaveFocus(); expect(role.closest("details")?.open).toBe(true);
    await user.selectOptions(role, "operator");
    await user.selectOptions(screen.getByRole("combobox", { name: "待模拟环境" }), "test");
    await user.click(screen.getByRole("button", { name: "检查规则设计" }));
    expect(screen.getByRole("status")).toHaveTextContent("未保存");
    expect(screen.getByText(/不会产生审批或暂停任务/)).toBeInTheDocument();
    expect(changes.at(-1)?.agentId).toMatch(/^harness-rule-conditions-draft:/);
    expect(changes.at(-1)?.dirty).toBe(true);
    await user.selectOptions(screen.getByRole("combobox", { name: "设计中的处理方式" }), "observe");
    expect(screen.getByText(/不会生成命中或审计记录/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看模拟结果" })).not.toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
  });
});
