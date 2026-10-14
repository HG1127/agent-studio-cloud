"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { CheckCircle2, PlugZap, X } from "lucide-react";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import type { WorkflowDraft } from "@/contracts/workflow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { readToolRegistryDefinitions } from "@/features/capabilities/tool-registry-definition";
import { ToolRegistryDefinitionDetails } from "@/features/capabilities/ToolRegistryDefinitionDetails";
import { notifyDraftState } from "@/lib/draft-state";
import { draftsEquivalent } from "./draft-recovery";
import { workflowStepGuide } from "./workflow-step-guide";
import { prepareWorkflowToolBindings, workflowToolBindingContextSnapshot, type WorkflowToolBindingSelection } from "./workflow-tool-binding-planning";

type BindingResult = ReturnType<typeof prepareWorkflowToolBindings>;
interface Props {
  workflow: WorkflowDraft;
  savedDraft: WorkflowDraft;
  toolOptions: ToolRegistryOption[];
  hasOtherChanges: boolean;
  pending: boolean;
  uncertainSave: boolean;
  feedback: { ok: boolean; text: string } | null;
  onUnappliedChange: (pending: boolean) => void;
  onApply: (selections: WorkflowToolBindingSelection[], expectedContext: string) => BindingResult;
  onSave: () => void;
  onClose: () => boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}
const FIELD = "w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:bg-slate-100";
const RISK_LABELS = { low: "低风险", medium: "中风险", high: "高风险" };
const STAGES = ["选择工具", "安排位置", "核对方案", "保存与下一步"] as const;

export function WorkflowToolBindingWizard({ workflow, savedDraft, toolOptions, hasOtherChanges, pending, uncertainSave, feedback, onUnappliedChange, onApply, onSave, onClose, returnFocusRef, fallbackFocusRef }: Props) {
  const instance = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const selectionsRef = useRef<WorkflowToolBindingSelection[]>([]);
  const [expectedContext] = useState(() => workflowToolBindingContextSnapshot(workflow, toolOptions));
  const [hadOtherChanges] = useState(hasOtherChanges);
  const [selections, setSelections] = useState<WorkflowToolBindingSelection[]>([]);
  const [stage, setStage] = useState(0);
  const [query, setQuery] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusTool, setFocusTool] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const [appliedDraft, setAppliedDraft] = useState<WorkflowDraft | null>(null);
  const currentContext = useMemo(() => workflowToolBindingContextSnapshot(workflow, toolOptions), [workflow, toolOptions]);
  const registered = useMemo(() => currentContext === null ? null : readToolRegistryDefinitions(toolOptions), [currentContext, toolOptions]);
  const steps = useMemo(() => workflowStepGuide(workflow, false), [workflow]);
  const plan = useMemo(() => prepareWorkflowToolBindings(workflow, toolOptions, selections), [workflow, toolOptions, selections]);
  const stale = expectedContext === null || currentContext !== expectedContext;
  const unapplied = selections.length > 0 && appliedDraft === null;
  const saved = appliedDraft !== null && draftsEquivalent(savedDraft, appliedDraft);
  const currentSaved = draftsEquivalent(workflow, savedDraft);
  const unchangedSinceApply = appliedDraft !== null && draftsEquivalent(workflow, appliedDraft);
  const locked = pending || uncertainSave;
  const draftKey = "workflow-tool-binding:" + instance;
  const errorId = instance + "-binding-error";
  const selectedTools = registered?.filter((tool) => selections.some((row) => row.toolId === tool.id)) ?? [];
  const visibleTools = registered?.filter((tool) => (tool.name + " " + tool.description).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) ?? [];

  useLayoutEffect(() => { notifyDraftState({ agentId: draftKey, dirty: unapplied }); }, [draftKey, unapplied]);
  useLayoutEffect(() => () => { notifyDraftState({ agentId: draftKey, dirty: false }); onUnappliedChange(false); }, [draftKey, onUnappliedChange]);
  useEffect(() => {
    if (!unapplied) return;
    function protectPage(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", protectPage);
    return () => window.removeEventListener("beforeunload", protectPage);
  }, [unapplied]);
  useLayoutEffect(() => { headingRef.current?.focus(); }, [stage]);
  useLayoutEffect(() => {
    if (!focusTool) return;
    const target = Array.from(rootRef.current?.querySelectorAll<HTMLSelectElement>("[data-binding-tool]") ?? [])
      .find((element) => element.dataset.bindingTool === focusTool);
    target?.focus();
  }, [focusTool, error, stage, validationAttempt]);

  function changeSelections(next: WorkflowToolBindingSelection[]) {
    selectionsRef.current = next;
    onUnappliedChange(next.length > 0);
    setSelections(next); setError(null); setFocusTool(null); setAcknowledged(false);
  }
  function requestClose() {
    if (pending) return;
    if (selectionsRef.current.length > 0 && appliedDraft === null) { setConfirmClose(true); return; }
    if (onClose()) onUnappliedChange(false);
  }
  function review() {
    if (locked || stale) return;
    setValidationAttempt((current) => current + 1);
    const incomplete = selections.find((row) => !row.targetNodeId);
    if (incomplete) {
      setError("请为每个所选工具明确选择使用位置。"); setFocusTool(incomplete.toolId); return;
    }
    if (!plan.ok) { setError(plan.error); setFocusTool(plan.toolId); return; }
    if (selections.length === 0) { setError("请先选择要使用的工具。"); return; }
    setError(null); setFocusTool(null); setStage(2);
  }
  function apply() {
    if (locked || stale || !acknowledged || !expectedContext) return;
    const result = onApply(selectionsRef.current, expectedContext);
    if (!result.ok) { setError(result.error); setFocusTool(result.toolId); setStage(1); return; }
    onUnappliedChange(false);
    setAppliedDraft(result.draft); setError(null); setStage(3);
  }

  return <>
    <Dialog.Root open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]" />
        <Dialog.Content ref={rootRef} aria-describedby={instance + "-description"}
          onCloseAutoFocus={(event) => {
            const preferred = returnFocusRef?.current;
            const target = preferred?.isConnected && !preferred.hasAttribute("disabled") ? preferred : fallbackFocusRef?.current;
            if (target?.isConnected && !target.hasAttribute("disabled")) { event.preventDefault(); target.focus(); }
          }}
          onEscapeKeyDown={(event) => { event.preventDefault(); requestClose(); }}
          onPointerDownOutside={(event) => { event.preventDefault(); }}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
            event.preventDefault(); event.stopPropagation();
            if (pending) return;
            if (appliedDraft === null) setError("请先核对方案并应用到本页草稿，再保存。");
            else onSave();
          }}
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none">
          <header className="flex items-start gap-3 border-b border-slate-200 p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><PlugZap className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="break-words text-lg font-bold text-slate-950">应用工具到流程</Dialog.Title>
              <Dialog.Description id={instance + "-description"} className="mt-1 break-words text-sm leading-6 text-slate-600">先选真实登记的工具，再明确它用在哪一步。应用后可撤销；保存只更新草稿，不修改已发布版本。</Dialog.Description>
            </div>
            <button ref={closeRef} type="button" aria-label="关闭工具绑定向导" onClick={requestClose} disabled={pending} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"><X className="size-5" /></button>
          </header>
          <ol aria-label="工具应用进度" className="grid grid-cols-4 gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs">
            {STAGES.map((label, index) => <li key={label} aria-current={index === stage ? "step" : undefined} className={index === stage ? "font-semibold text-indigo-700" : "text-slate-500"}>{index + 1}. {label}</li>)}
          </ol>
          <div className="min-h-0 space-y-4 overflow-y-auto p-5">
            <h3 ref={headingRef} tabIndex={-1} className="text-base font-bold text-slate-950 outline-none">{STAGES[stage]}</h3>
            {appliedDraft === null && stale ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">流程或工具登记已变化，当前方案不能应用。请关闭并重新打开向导，依据最新内容重新选择；原有草稿不会被覆盖。</p> : null}
            {hadOtherChanges ? <p className="text-xs leading-5 text-amber-800">打开向导前已有其他草稿修改；保存时会一并提交，请同时核对。</p> : null}
            {stage === 0 ? <>
              <label className="block text-sm font-medium text-slate-700">查找工具<input aria-label="查找已登记工具" value={query} onChange={(event) => setQuery(event.target.value)} className={FIELD + " mt-1"} placeholder="按名称或用途查找" /></label>
              {registered === null ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">当前工具登记暂时无法读取，不能安排使用位置。请重新读取页面后再试。</p>
                : registered.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm leading-6 text-slate-600">目前没有登记的业务工具。请先完成工具登记，再回到这里安排流程；此处不会创建演示工具。</p>
                : visibleTools.length === 0 ? <p role="status" className="text-sm text-slate-500">没有符合查找条件的工具。已选择的工具仍保留。</p>
                : <div className="grid gap-3 md:grid-cols-2">{visibleTools.map((tool) => <Card key={tool.id} className="p-4">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" aria-label={"选择工具 " + tool.name} checked={selections.some((row) => row.toolId === tool.id)} disabled={locked || stale} className="mt-1 size-4"
                      onChange={(event) => changeSelections(event.target.checked ? [...selectionsRef.current, { toolId: tool.id, mode: "existing", targetNodeId: "" }] : selectionsRef.current.filter((row) => row.toolId !== tool.id))} />
                    <span className="min-w-0"><span className="block break-words text-sm font-semibold text-slate-900">{tool.name}</span><span className="mt-1 block break-words text-xs leading-5 text-slate-600">{tool.description || "尚未填写用途说明"}</span><span className="mt-2 block text-xs text-slate-500">{RISK_LABELS[tool.risk]} · {tool.operationKind === "read" ? "读取资料" : tool.operationKind === "action" ? "执行操作" : "读写性质待核对"}</span></span>
                  </label>
                </Card>)}</div>}
              <p role="status" className="text-xs text-slate-600">已选择 {selections.length} 个工具。连接状态和账号权限仍需另行核对。</p>
            </> : null}
            {stage === 1 ? <div className="space-y-3">{selections.map((row, index) => {
              const tool = selectedTools.find((item) => item.id === row.toolId);
              const available = steps.filter(({ node }) => row.mode === "existing" ? node.type === "tool" : node.type !== "end");
              return <Card key={row.toolId} className="space-y-3 p-4">
                <p className="break-words text-sm font-semibold text-slate-950">{tool?.name ?? "所选工具暂时无法核对"}</p>
                <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
                  <label className="text-xs font-medium text-slate-600">使用方式<select aria-label={"工具 " + (index + 1) + " 使用方式"} value={row.mode} disabled={locked || stale} className={FIELD + " mt-1"}
                    onChange={(event) => changeSelections(selectionsRef.current.map((item) => item.toolId === row.toolId ? { ...item, mode: event.target.value as WorkflowToolBindingSelection["mode"], targetNodeId: "" } : item))}>
                    <option value="existing">绑定已有工具步骤</option><option value="after">在指定步骤后插入</option>
                  </select></label>
                  <label className="text-xs font-medium text-slate-600">使用位置<select aria-label={"工具 " + (index + 1) + " 使用位置"} data-binding-tool={row.toolId} value={row.targetNodeId} disabled={locked || stale} aria-invalid={focusTool === row.toolId || undefined} aria-describedby={focusTool === row.toolId ? errorId : undefined} className={FIELD + " mt-1"}
                    onChange={(event) => changeSelections(selectionsRef.current.map((item) => item.toolId === row.toolId ? { ...item, targetNodeId: event.target.value } : item))}>
                    <option value="">请明确选择位置</option>
                    {available.map(({ node }, itemIndex) => <option key={node.id} value={node.id}>{node.title}{row.mode === "after" ? node.type === "condition" ? " · 默认路径之后" : node.type === "loop" ? " · 循环完成之后" : " · 完成之后" : ""}（清单 {itemIndex + 1}）</option>)}
                  </select></label>
                </div>
                {available.length === 0 ? <p className="text-xs leading-5 text-amber-800">没有符合条件的已有步骤。可改为在指定步骤后插入；不会自动猜测主要交付位置。</p> : null}
                <p className="text-xs leading-5 text-slate-500">条件步骤只插入默认路径，循环步骤只插入完成路径；多个工具放在同一位置时按本清单顺序串接，其他分支不变。</p>
              </Card>;
            })}</div> : null}
            {stage === 2 && plan.ok ? <>
              <div className="space-y-3">{plan.changes.map((change) => <Card key={change.toolId} className="space-y-2 p-4">
                <p className="break-words text-sm font-semibold text-slate-950">{change.toolName} → {change.nodeTitle}</p>
                <p className="break-words text-xs leading-5 text-slate-600">{change.mode === "after" ? "新增工具步骤" : "保留已有步骤与原连线"} · {change.changedFields.length ? "更新：" + change.changedFields.join("、") : "当前登记与步骤配置一致，不产生绑定变更"}</p>
                {(change.hasInputMapping || change.hasToolOperation) ? <p className="text-xs leading-5 text-amber-800">原{[change.hasInputMapping ? "输入映射" : "", change.hasToolOperation ? "业务防重配置" : ""].filter(Boolean).join("、")}会保留。新工具可能需要不同字段；应用后请在步骤设置中逐项核对，不能据此认定运行通过。</p> : null}
                {selectedTools.find((tool) => tool.id === change.toolId) ? <details className="rounded-lg border border-slate-200 p-3 text-xs leading-6 text-slate-600"><summary className="cursor-pointer font-semibold text-slate-700">核对输入、结果字段与执行边界</summary><ToolRegistryDefinitionDetails tool={selectedTools.find((tool) => tool.id === change.toolId)!} /></details> : null}
              </Card>)}</div>
              <p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">这一步只安排工具使用位置和登记配置，不会调用工具、发放权限或生成已发布版本。保存后仍需设计检查、发布和试运行。</p>
              <label className="flex items-start gap-2 text-sm leading-6 text-slate-700"><input aria-label="确认已核对工具使用方案" type="checkbox" checked={acknowledged} disabled={locked || stale} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1.5 size-4 shrink-0" />我已核对所选位置、工具风险与保留配置；应用后将检查输入和交付字段。</label>
            </> : null}
            {stage === 3 ? <>
              <div className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" /><div className="min-w-0"><p className="text-sm font-semibold text-emerald-900">{saved && !uncertainSave ? "此方案对应的草稿已保存" : currentSaved && !uncertainSave ? "当前草稿已保存，并在应用后更新" : "工具方案已应用到本页草稿"}</p><p className="mt-1 text-sm leading-6 text-emerald-900">{currentSaved && !uncertainSave ? "保存不等于已发布或运行通过。" : "尚未确认当前草稿已保存到服务端。返回画布可检查设置。"}</p></div></div>
              {!unchangedSinceApply ? <p role="status" className="text-sm leading-6 text-amber-900">画布已在应用后发生修改。{currentSaved && !uncertainSave ? "当前内容与服务端保存副本一致；" : "保存会提交当前草稿，"}请返回画布核对；不会覆盖为向导里的旧方案。</p> : null}
              {uncertainSave ? <p role="alert" className="text-sm leading-6 text-amber-900">上次保存结果尚未确认。请核对原提交；不会另建一份请求或重复应用工具方案。</p> : null}
              {feedback ? <p role={feedback.ok ? "status" : "alert"} className={"break-words text-sm leading-6 " + (feedback.ok ? "text-emerald-800" : "text-red-800")}>{feedback.text}</p> : null}
              <ol className="space-y-2 text-sm leading-6 text-slate-600"><li>1. 返回画布，核对新增或重新绑定步骤的输入、交付字段和确认要求。</li><li>2. 保存后在本页设计检查区域核对问题。</li><li>3. 在本页版本区域按现有流程发布与试运行。</li></ol>
            </> : null}
            {error ? <p id={errorId} role="alert" className="break-words rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800">{error}</p> : null}
          </div>
          <footer className="flex flex-wrap justify-between gap-3 border-t border-slate-200 bg-slate-50 p-4">
            <Button type="button" variant="secondary" disabled={pending} onClick={requestClose}>{stage === 3 ? "返回画布检查" : "取消"}</Button>
            <div className="flex flex-wrap gap-2">
              {stage > 0 && stage < 3 ? <Button type="button" variant="secondary" disabled={locked} onClick={() => { setStage(stage - 1); setError(null); setFocusTool(null); setAcknowledged(false); }}>上一步</Button> : null}
              {stage === 0 ? <Button type="button" disabled={locked || stale || selections.length === 0} onClick={() => setStage(1)}>安排使用位置</Button> : null}
              {stage === 1 ? <Button type="button" disabled={locked || stale || selections.length === 0} onClick={review}>核对变更方案</Button> : null}
              {stage === 2 ? <Button type="button" disabled={locked || stale || !acknowledged || !plan.ok} onClick={apply}>应用到本页草稿</Button> : null}
              {stage === 3 ? <Button type="button" disabled={pending || (!uncertainSave && currentSaved)} onClick={onSave}>{pending ? "正在处理保存…" : uncertainSave ? "核对原提交结果" : "保存当前草稿"}</Button> : null}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <ConfirmDialog open={confirmClose} onOpenChange={setConfirmClose} title="放弃本次绑定方案？" description="只会清除向导中尚未应用的选择，不改动本页流程草稿。返回可继续安排位置。" confirmLabel="放弃本次选择" tone="warning" pending={pending} returnFocusRef={closeRef}
      onConfirm={() => { if (!onClose()) return; selectionsRef.current = []; onUnappliedChange(false); setConfirmClose(false); }} />
  </>;
}
