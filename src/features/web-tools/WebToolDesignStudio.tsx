"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Eye, FileText, Plus, SlidersHorizontal, Trash2, Wand2 } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import { CapabilityNotice } from "@/components/ui/CapabilityNotice";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyDraftState } from "@/lib/draft-state";
import { WebToolLayoutPreview } from "./WebToolLayoutPreview";
import { planWebToolInputCommand } from "./web-tool-input-command";
import { WEB_TOOL_AUDIENCES, WEB_TOOL_LAYOUTS, WEB_TOOL_MODULES, WEB_TOOL_STEPS, checkWebToolDesign,
  createWebToolDesignDraft, designFieldsFromTarget, readWebToolDesignJson, reorderDesignItem,
  type WebToolDesignDraft, type WebToolDesignField, type WebToolDesignModule } from "./web-tool-design-draft";

const control = "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-100 aria-invalid:border-red-400";
const section = "min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
type Confirmation = { action: "clear" | "replace-inputs" | "remove-field" | "remove-module" | "discard-editor"; id?: string; name?: string; viaCommand?: boolean };

export function WebToolDesignStudio({ targets }: { targets: AgentTargetOption[] | null }) {
  const instanceId = useId();
  const [draft, setDraft] = useState(createWebToolDesignDraft);
  const [dirty, setDirty] = useState(false);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"smart" | "pro">("smart");
  const [editor, setEditor] = useState<string | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewSession, setPreviewSession] = useState(0);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [inputCommand, setInputCommand] = useState("");
  const [commandTarget, setCommandTarget] = useState("");
  const nextItemRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const addFieldRef = useRef<HTMLButtonElement | null>(null);
  const addModuleRef = useRef<HTMLButtonElement | null>(null);
  const commandApplyRef = useRef<HTMLButtonElement | null>(null);
  const designRootRef = useRef<HTMLDivElement | null>(null);
  const serialized = JSON.stringify(draft, null, 2);
  const editorDirty = editor !== null && editor !== serialized;
  const commandDirty = inputCommand.length > 0;
  const commandPlan = planWebToolInputCommand(inputCommand, draft.fields, commandTarget);
  const selectedTarget = targets?.find((target) => target.versionId === draft.versionId);
  const draftKey = "web-tool-design:" + instanceId;
  const feedbackId = instanceId + "-design-feedback";
  useLayoutEffect(() => { notifyDraftState({ agentId: draftKey, dirty: dirty || editorDirty || commandDirty }); }, [draftKey, dirty, editorDirty, commandDirty]);
  useLayoutEffect(() => () => notifyDraftState({ agentId: draftKey, dirty: false }), [draftKey]);
  useLayoutEffect(() => {
    if (!problem) return;
    const target = Array.from(designRootRef.current?.querySelectorAll<HTMLElement>("[data-design-field]") ?? [])
      .find((element) => element.dataset.designField === problem.key);
    if (!target?.isConnected) return;
    const details = target.closest("details");
    if (details) details.open = true;
    target.focus();
  }, [problem]);

  function markProblem(issue: ReturnType<typeof checkWebToolDesign>[number]) {
    const field = String(issue.path?.[0] ?? "");
    const index = typeof issue.path?.[1] === "number" ? issue.path[1] : 0;
    const property = String(issue.path?.[2] ?? "label");
    const key = field === "fields" ? "field-" + index + "-" + (["name", "label", "rows", "type", "placeholder", "description"].includes(property) ? property : "label")
      : field === "modules" ? "module-" + index + "-" + (["source", "description"].includes(property) ? property : "title")
        : ["name", "slug", "versionId", "description", "targetAudience", "audienceType", "accessMode", "domains", "maxPerHour", "maxPerDay", "maxConcurrent", "maxRuntimeSeconds", "maxCostUnits", "allowWriteScopes"].includes(field) ? field : "step-" + issue.step;
    setProblem({ key, text: issue.message });
  }
  function problemAttributes(key: string) {
    return { "data-design-field": key, "aria-invalid": problem?.key === key || undefined,
      "aria-describedby": problem?.key === key ? feedbackId : undefined };
  }

  function updateDraft<K extends keyof WebToolDesignDraft>(key: K, value: WebToolDesignDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setFeedback(null);
    setProblem(null);
  }
  function updateField(id: string, updates: Partial<WebToolDesignField>) {
    updateDraft("fields", draft.fields.map((field) => field.id === id ? { ...field, ...updates } : field));
  }
  function updateModule(id: string, updates: Partial<WebToolDesignModule>) {
    updateDraft("modules", draft.modules.map((module) => module.id === id ? { ...module, ...updates } : module));
  }
  function nextItemId(kind: "input" | "module") {
    let id: string;
    do { id = kind + "-" + instanceId + "-" + (++nextItemRef.current); }
    while (draft.fields.some((field) => field.id === id) || draft.modules.some((module) => module.id === id));
    return id;
  }
  function addField(label = "新输入项", required = true) {
    if (draft.fields.length >= 100) { setFeedback({ error: true, text: "最多可设计 100 个输入项。" }); return; }
    const id = nextItemId("input");
    let name = "input_" + nextItemRef.current;
    while (draft.fields.some((field) => field.name === name)) name += "_";
    updateDraft("fields", [...draft.fields, { id, name, label,
      type: "string", required, rows: 3, placeholder: "", description: "" }]);
  }
  function applyInputCommand(trigger: HTMLElement) {
    if (commandPlan.state !== "ready") return;
    if (commandPlan.command.kind === "remove" && commandPlan.field) {
      requestConfirmation({ action: "remove-field", id: commandPlan.field.id, name: commandPlan.field.label, viaCommand: true }, trigger);
      return;
    }
    if (commandPlan.command.kind === "add") addField(commandPlan.command.label, false);
    else if (commandPlan.command.kind === "required" && commandPlan.field) updateField(commandPlan.field.id, { required: commandPlan.command.required });
    setInputCommand(""); setCommandTarget("");
    setFeedback({ error: false, text: "已应用到本页草稿：" + commandPlan.message + " 尚未保存或发布。" });
  }
  function addModule() {
    if (draft.modules.length >= 100) { setFeedback({ error: true, text: "最多可设计 100 个结果模块。" }); return; }
    const id = nextItemId("module");
    updateDraft("modules", [...draft.modules, { id,
      title: "新结果模块", source: "result", component: "ResultCard", enabled: true, description: "" }]);
  }
  function requestConfirmation(next: Confirmation, trigger: HTMLElement) {
    returnFocusRef.current = trigger;
    setConfirmation(next);
  }
  function confirmChange() {
    if (!confirmation) return;
    if (confirmation.action === "clear") {
      setDraft(createWebToolDesignDraft()); setDirty(false); setEditor(null); setMode("smart"); setStep(0);
      setPreviewValues({}); setPreviewSession((current) => current + 1); setFeedback(null);
      setProblem(null);
      setInputCommand(""); setCommandTarget("");
    } else if (confirmation.action === "discard-editor") {
      setEditor(null); setMode("smart"); setFeedback(null); setProblem(null);
    } else if (confirmation.action === "replace-inputs") {
      if (!selectedTarget) {
        setFeedback({ error: true, text: "当前无法核对所选正式版本，原表单和填写已保留。" });
      } else {
        updateDraft("fields", designFieldsFromTarget(selectedTarget));
        setPreviewValues({}); setPreviewSession((current) => current + 1);
      }
    } else if (confirmation.action === "remove-field") {
      returnFocusRef.current = addFieldRef.current;
      updateDraft("fields", draft.fields.filter((field) => field.id !== confirmation.id));
      setPreviewValues((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== confirmation.id)));
      setPreviewSession((current) => current + 1);
      if (confirmation.viaCommand) { setInputCommand(""); setCommandTarget(""); }
    } else if (confirmation.action === "remove-module") {
      returnFocusRef.current = addModuleRef.current;
      updateDraft("modules", draft.modules.filter((module) => module.id !== confirmation.id));
    }
    setConfirmation(null);
  }
  function goToStep(next: number) {
    if (next > step) {
      const issue = checkWebToolDesign(draft, targets).find((item) => !item.source && item.step < next);
      if (issue) { setStep(issue.step); setFeedback({ error: true, text: issue.message }); markProblem(issue); return; }
    }
    setStep(next); setFeedback(null); setProblem(null);
  }
  function checkDraft() {
    if (editorDirty) { setFeedback({ error: true, text: "专业配置有未应用修改，请先应用或返回向导；原草稿未变。" }); return; }
    const issues = checkWebToolDesign(draft, targets);
    if (issues.length) {
      setStep(issues[0].step); setMode("smart"); setEditor(null);
      setFeedback({ error: true, text: issues.map((issue) => issue.message).join("；") });
      markProblem(issues[0]);
    } else setFeedback({ error: false, text: "本页草稿检查完成，尚未保存或发布。" + (!draft.versionId ? " 尚未关联正式助手，真实调用仍需选择实际版本。" : "") });
  }
  function switchMode(next: "smart" | "pro", trigger: HTMLElement) {
    if (next === mode) return;
    if (next === "smart" && editorDirty) { requestConfirmation({ action: "discard-editor" }, trigger); return; }
    setMode(next); setEditor(next === "pro" ? serialized : null); setFeedback(null); setProblem(null);
  }
  function applyEditor() {
    const result = readWebToolDesignJson(editor ?? serialized);
    if (!result.ok) { setFeedback({ error: true, text: result.message }); return; }
    const sourceIssue = checkWebToolDesign(result.draft, targets).find((issue) => issue.step === 0);
    if (sourceIssue && result.draft.versionId !== draft.versionId) { setFeedback({ error: true, text: sourceIssue.message + "；原草稿未变。" }); return; }
    setDraft(result.draft); setEditor(JSON.stringify(result.draft, null, 2)); setDirty(true);
    setProblem(null);
    setFeedback({ error: false, text: "专业配置已应用到本页草稿，没有保存到系统。" });
  }
  function formatEditor() {
    if (new TextEncoder().encode(editor ?? serialized).byteLength > 100 * 1024) {
      setFeedback({ error: true, text: "专业配置不能超过 100 千字节，未改变填写。" }); return;
    }
    try {
      const parsed: unknown = JSON.parse(editor ?? serialized);
      setEditor(JSON.stringify(parsed, null, 2)); setFeedback(null); setProblem(null);
    } catch { setFeedback({ error: true, text: "配置不是有效的结构化文本，未改变填写。" }); }
  }
  const confirmationText = confirmation?.action === "clear" ? "将清空本页页面设计、未应用专业配置与预览填写，不会删除系统中的工具。"
    : confirmation?.action === "replace-inputs" ? "将用当前所选正式版本的真实输入字段替换本页输入项，并清除预览填写。名称、结果模块及访问设计保持。"
      : confirmation?.action === "discard-editor" ? "专业配置的未应用修改将丢弃，已应用到本页的草稿保持。"
        : "将从本页草稿移除「" + (confirmation?.name || "未命名项目") + "」，不会修改已发布工具。";

  return <div ref={designRootRef} className="min-w-0 space-y-5">
    <CapabilityNotice mode="draft" title="页面设计草稿 · 尚未保存">
      依据四步配置设计网页表单与结果布局。保存页面配置、公开展示、网页嵌入和访问规则接口尚未接入；本页不会发布、执行或生成业务结果。
    </CapabilityNotice>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="页面设计编辑方式">
        <Button type="button" variant={mode === "smart" ? "secondary" : "ghost"} aria-pressed={mode === "smart"} onClick={(event) => switchMode("smart", event.currentTarget)}><Wand2 aria-hidden="true" className="size-4" />向导模式</Button>
        <Button type="button" variant={mode === "pro" ? "secondary" : "ghost"} aria-pressed={mode === "pro"} onClick={(event) => switchMode("pro", event.currentTarget)}><SlidersHorizontal aria-hidden="true" className="size-4" />专业配置</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500">{dirty || editorDirty ? "有未保存填写" : "新设计，尚未保存"}</span>
        <Button type="button" variant="ghost" onClick={(event) => requestConfirmation({ action: "clear" }, event.currentTarget)}><Trash2 aria-hidden="true" className="size-4" />清空草稿</Button>
      </div>
    </div>
    {feedback ? <div id={feedbackId} role={feedback.error ? "alert" : "status"} className={"break-words rounded-xl border p-3 text-sm leading-6 " + (feedback.error ? "border-red-200 bg-red-50 text-red-800" : "border-indigo-200 bg-indigo-50 text-indigo-800")}>{feedback.text}</div> : null}
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        {mode === "smart" ? <>
          <nav aria-label="网页工具设计步骤" className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2 2xl:grid-cols-4">
            {WEB_TOOL_STEPS.map((label, index) => <button key={label} type="button" aria-current={step === index ? "step" : undefined} onClick={() => goToStep(index)}
              className={"min-w-0 rounded-lg px-3 py-2 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 " + (step === index ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50")}>{index + 1}. {label}</button>)}
          </nav>
          {step === 0 ? <section className={section} aria-label="基本信息配置" tabIndex={-1} data-design-field="step-0">
            <div><h3 className="font-bold text-slate-900">第一步：基本信息</h3><p className="mt-1 text-xs leading-5 text-slate-500">明确给谁用、收集什么和如何交付；不会自动生成或推断业务内容。</p></div>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">工具展示名称<input {...problemAttributes("name")} className={control} value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="填写工具名称，最多 200 字" /></label>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">工具说明<textarea {...problemAttributes("description")} rows={3} className={control} value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} placeholder="说明使用者需要提供的信息与期望交付物" /></label>
            <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">目标使用受众<input {...problemAttributes("targetAudience")} className={control} value={draft.targetAudience} onChange={(event) => updateDraft("targetAudience", event.target.value)} placeholder="例如：部门团队成员" /></label>
              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">访问路径草案<input {...problemAttributes("slug")} className={control} value={draft.slug} onChange={(event) => updateDraft("slug", event.target.value)} placeholder="小写字母、数字与短横线，可暂留空" /></label>
            </div>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">关联正式助手版本<select {...problemAttributes("versionId")} className={control} value={draft.versionId} onChange={(event) => updateDraft("versionId", event.target.value)}>
              <option value="">暂不关联，可继续设计</option>
              {(targets ?? []).map((target) => <option key={target.versionId} value={target.versionId}>{target.agentName.trim() && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(target.agentName.trim()) ? target.agentName : "正式助手"} · 第 {target.version} 版</option>)}
              {draft.versionId && !selectedTarget ? <option value={draft.versionId}>此前选择当前无法核对</option> : null}
            </select></label>
            {targets === null ? <p role="alert" className="text-sm text-amber-800">正式助手读取失败，仍可设计页面；没有用示例助手替代。</p>
              : targets.length === 0 ? <p className="text-sm text-slate-500">尚无可选择的正式助手版本，页面设计不受影响。</p> : null}
            {draft.versionId && !selectedTarget ? <p className="text-sm text-amber-800">此前选择尚未确认，未自动换成其他版本；原设计已保留。</p> : null}
            <p className="text-xs leading-5 text-slate-500">关联仅记录本页设计来源，不会发布或改动正式助手。访问路径也不会产生可用链接。</p>
          </section> : null}
          {step === 1 ? <section className={section} aria-label="输入项配置" tabIndex={-1} data-design-field="step-1">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-slate-900">第二步：输入项</h3><p className="mt-1 text-xs text-slate-500">可添加、编辑、调整顺序和必填项。</p></div>
              <button ref={addFieldRef} type="button" className={buttonVariants({ size: "sm" })} onClick={() => addField()}><Plus aria-hidden="true" className="size-4" />添加输入项</button></div>
            <Button type="button" variant="secondary" disabled={!selectedTarget} onClick={(event) => requestConfirmation({ action: "replace-inputs" }, event.currentTarget)}>按正式输入生成表单</Button>
            <p className="text-xs leading-5 text-slate-500">手动编辑只改变页面设计，不改变正式助手的输入契约；之后接入保存时还须核对字段映射。</p>
            <section aria-label="中文快捷编辑输入项" className="min-w-0 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
              <div><h4 className="text-sm font-semibold text-indigo-950">中文快捷编辑</h4><p id={instanceId + "-command-help"} className="mt-1 text-xs leading-5 text-slate-600">使用本页固定规则，不调用模型。支持“添加「本周收获」”“删除「下周计划」”“把「下周计划」设为必填”，也可设为选填。先核对变更，再明确应用。</p></div>
              <label className="block space-y-1 text-sm font-medium text-slate-700">用中文调整输入项<input className={control} value={inputCommand} maxLength={240} aria-describedby={instanceId + "-command-help"} onChange={(event) => { setInputCommand(event.target.value); setCommandTarget(""); }} onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); commandApplyRef.current?.focus(); }
              }} placeholder="例如：加一个本周最大的收获" /></label>
              {commandPlan.choices.length > 1 || commandTarget ? <label className="block space-y-1 text-sm text-slate-700">选择要调整的输入项<select className={control} value={commandTarget} onChange={(event) => setCommandTarget(event.target.value)}><option value="">请明确选择，不会批量修改</option>{commandPlan.choices.map((choice) => <option key={choice.id} value={choice.id}>输入项 {choice.position} · {choice.label}</option>)}</select></label> : null}
              <p id={instanceId + "-command-result"} className="break-words text-xs leading-5 text-slate-700">{commandPlan.state === "ready" ? "待应用的变更：" : ""}{commandPlan.message}</p>
              <button ref={commandApplyRef} type="button" className={buttonVariants({ size: "sm", variant: "secondary" })} disabled={commandPlan.state !== "ready"} aria-describedby={instanceId + "-command-result"} onClick={(event) => applyInputCommand(event.currentTarget)}>确认应用到本页</button>
            </section>
            {draft.fields.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">还没有输入项。可从真实正式版本读取字段，或手动添加。</p> : null}
            {draft.fields.map((field, index) => <fieldset key={field.id} className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-500">输入项 {index + 1}</legend>
              <label className="block space-y-1 text-sm font-semibold text-slate-700">显示名称<input {...problemAttributes("field-" + index + "-label")} className={control} value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value })} /></label>
              <div className="grid min-w-0 gap-3 2xl:grid-cols-2"><label className="block space-y-1 text-sm text-slate-700">输入类型<select {...problemAttributes("field-" + index + "-type")} className={control} value={field.type} onChange={(event) => {
                const type = event.target.value;
                if (type === "string" || type === "number" || type === "boolean" || type === "object" || type === "array") {
                  const invalidHiddenRows = type !== "string" && (!Number.isInteger(field.rows) || field.rows < 1 || field.rows > 12);
                  updateField(field.id, { type, ...(invalidHiddenRows ? { rows: 1 } : {}) });
                }
              }}><option value="string">文本</option><option value="number">数字</option><option value="boolean">是或否</option><option value="object">结构化对象</option><option value="array">结构化列表</option></select></label>
                {field.type === "string" ? <label className="block space-y-1 text-sm text-slate-700">文本显示行数<input {...problemAttributes("field-" + index + "-rows")} type="number" min={1} max={12} className={control} value={Number.isFinite(field.rows) ? field.rows : ""} onChange={(event) => updateField(field.id, { rows: event.target.valueAsNumber })} /></label> : null}</div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} />设为必填</label>
              <label className="block space-y-1 text-sm text-slate-700">填写提示<input {...problemAttributes("field-" + index + "-placeholder")} className={control} value={field.placeholder} onChange={(event) => updateField(field.id, { placeholder: event.target.value })} /></label>
              <label className="block space-y-1 text-sm text-slate-700">补充说明<textarea {...problemAttributes("field-" + index + "-description")} rows={2} className={control} value={field.description} onChange={(event) => updateField(field.id, { description: event.target.value })} /></label>
              <details className="min-w-0 text-xs text-slate-500"><summary className="cursor-pointer font-semibold">字段映射（开发者）</summary><label className="mt-2 block space-y-1">输入字段标识<input {...problemAttributes("field-" + index + "-name")} className={control} value={field.name} onChange={(event) => updateField(field.id, { name: event.target.value })} /></label></details>
              <div className="flex flex-wrap gap-1"><Button type="button" variant="ghost" size="sm" aria-label={"上移输入项 " + (index + 1)} disabled={index === 0} onClick={() => updateDraft("fields", reorderDesignItem(draft.fields, index, -1))}><ArrowUp aria-hidden="true" className="size-4" />上移</Button>
                <Button type="button" variant="ghost" size="sm" aria-label={"下移输入项 " + (index + 1)} disabled={index === draft.fields.length - 1} onClick={() => updateDraft("fields", reorderDesignItem(draft.fields, index, 1))}><ArrowDown aria-hidden="true" className="size-4" />下移</Button>
                <Button type="button" variant="ghost" size="sm" aria-label={"移除输入项 " + (index + 1)} onClick={(event) => requestConfirmation({ action: "remove-field", id: field.id, name: field.label }, event.currentTarget)}><Trash2 aria-hidden="true" className="size-4" />移除</Button></div>
            </fieldset>)}
          </section> : null}
          {step === 2 ? <section className={section} aria-label="结果呈现配置" tabIndex={-1} data-design-field="step-2">
            <div><h3 className="font-bold text-slate-900">第三步：结果呈现</h3><p className="mt-1 text-xs leading-5 text-slate-500">选择版式、添加模块并调整显示顺序。版式不会生成示例结果或替换已有模块。</p></div>
            <div className="grid min-w-0 grid-cols-2 gap-2" role="group" aria-label="结果版式">
              {WEB_TOOL_LAYOUTS.map((layout) => <button key={layout.value} type="button" aria-pressed={draft.preset === layout.value} onClick={() => updateDraft("preset", layout.value)}
                className={"min-w-0 rounded-xl border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 " + (draft.preset === layout.value ? "border-indigo-300 bg-indigo-50" : "border-slate-200 hover:bg-slate-50")}><span className="block text-sm font-semibold text-slate-800">{layout.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{layout.description}</span></button>)}
            </div>
            <button ref={addModuleRef} type="button" className={buttonVariants({ variant: "secondary" })} onClick={addModule}><Plus aria-hidden="true" className="size-4" />添加结果模块</button>
            {draft.modules.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">尚未设计结果模块。右侧不会显示假业务数据。</p> : null}
            {draft.modules.map((module, index) => <fieldset key={module.id} className="min-w-0 space-y-3 rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-500">结果模块 {index + 1}</legend>
              <label className="block space-y-1 text-sm text-slate-700">模块标题<input {...problemAttributes("module-" + index + "-title")} className={control} value={module.title} onChange={(event) => updateModule(module.id, { title: event.target.value })} /></label>
              <label className="block space-y-1 text-sm text-slate-700">展示方式<select className={control} value={module.component} onChange={(event) => {
                const chosen = WEB_TOOL_MODULES.find((item) => item.value === event.target.value);
                if (chosen) updateModule(module.id, { component: chosen.value });
              }}>{WEB_TOOL_MODULES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label className="block space-y-1 text-sm text-slate-700">模块说明<textarea {...problemAttributes("module-" + index + "-description")} rows={2} className={control} value={module.description} onChange={(event) => updateModule(module.id, { description: event.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={module.enabled} onChange={(event) => updateModule(module.id, { enabled: event.target.checked })} />显示此模块</label>
              <details className="text-xs text-slate-500"><summary className="cursor-pointer font-semibold">结果映射（开发者）</summary><label className="mt-2 block space-y-1">结果来源字段<input {...problemAttributes("module-" + index + "-source")} className={control} value={module.source} onChange={(event) => updateModule(module.id, { source: event.target.value })} /></label></details>
              <div className="flex flex-wrap gap-1"><Button type="button" variant="ghost" size="sm" aria-label={"上移结果模块 " + (index + 1)} disabled={index === 0} onClick={() => updateDraft("modules", reorderDesignItem(draft.modules, index, -1))}><ArrowUp aria-hidden="true" className="size-4" />上移</Button>
                <Button type="button" variant="ghost" size="sm" aria-label={"下移结果模块 " + (index + 1)} disabled={index === draft.modules.length - 1} onClick={() => updateDraft("modules", reorderDesignItem(draft.modules, index, 1))}><ArrowDown aria-hidden="true" className="size-4" />下移</Button>
                <Button type="button" variant="ghost" size="sm" aria-label={"移除结果模块 " + (index + 1)} onClick={(event) => requestConfirmation({ action: "remove-module", id: module.id, name: module.title }, event.currentTarget)}><Trash2 aria-hidden="true" className="size-4" />移除</Button></div>
            </fieldset>)}
          </section> : null}
          {step === 3 ? <section className={section} aria-label="访问与发布配置" tabIndex={-1} data-design-field="step-3">
            <div><h3 className="font-bold text-slate-900">第四步：访问与发布</h3><p className="mt-1 text-xs leading-5 text-slate-500">以下只是访问方案，没有授权任何网站或用户，没有执行限额。</p></div>
            <label className="block space-y-1 text-sm text-slate-700">谁可以使用<select {...problemAttributes("audienceType")} className={control} value={draft.audienceType} onChange={(event) => {
              const chosen = WEB_TOOL_AUDIENCES.find((item) => item.value === event.target.value);
              if (chosen) updateDraft("audienceType", chosen.value);
            }}>{WEB_TOOL_AUDIENCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="block space-y-1 text-sm text-slate-700">访问凭据方案<select {...problemAttributes("accessMode")} className={control} value={draft.accessMode} onChange={(event) => updateDraft("accessMode", event.target.value === "credential" ? "credential" : "anonymous")}><option value="credential">需要专用凭据</option><option value="anonymous">不要求凭据（方案）</option></select></label>
            <label className="block space-y-1 text-sm text-slate-700">指定网站来源<textarea {...problemAttributes("domains")} rows={3} className={control} value={draft.domains} onChange={(event) => updateDraft("domains", event.target.value)} placeholder="每行一个完整网站地址，不含访问路径" /></label>
            <p className="text-xs leading-5 text-slate-500">留空不代表已允许所有网站。站点授权、跨域和登录控制均待接口接入。</p>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              {([{ key: "maxPerHour", label: "每小时次数上限" }, { key: "maxPerDay", label: "每天次数上限" },
                { key: "maxConcurrent", label: "最大并发数" }, { key: "maxRuntimeSeconds", label: "最长运行时间（秒）" }, { key: "maxCostUnits", label: "成本额度上限" }] as const).map((item) => <label key={item.key} className="block min-w-0 space-y-1 text-sm text-slate-700">{item.label}<input {...problemAttributes(item.key)} type="number" min={item.key === "maxCostUnits" ? 0 : 1} step={item.key === "maxCostUnits" ? "any" : 1} className={control} value={Number.isFinite(draft[item.key]) ? draft[item.key] : ""} onChange={(event) => updateDraft(item.key, event.target.valueAsNumber)} /></label>)}
            </div>
            <label className="block space-y-1 text-sm text-slate-700">允许的写入或发送权限<textarea {...problemAttributes("allowWriteScopes")} rows={3} className={control} value={draft.allowWriteScopes} onChange={(event) => updateDraft("allowWriteScopes", event.target.value)} placeholder="逐行填写权限名称；这里只记录设计，不授予执行权限" /></label>
            <CapabilityNotice mode="draft" title="保存与公开发布待接入">页面配置保存、公开展示与嵌入、访问控制和工具统计需要后端接口；本页检查不等于安全审查通过或发布完成。</CapabilityNotice>
          </section> : null}
          <div className="flex flex-wrap justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <Button type="button" variant="secondary" disabled={step === 0} onClick={() => goToStep(step - 1)}>上一步</Button>
            {step < WEB_TOOL_STEPS.length - 1 ? <Button type="button" onClick={() => goToStep(step + 1)}>下一步</Button> : <Button type="button" onClick={checkDraft}>检查全部草稿</Button>}
          </div>
        </> : <section className={section} aria-label="专业配置编辑">
          <h3 className="font-bold text-slate-900">专业配置（开发者）</h3>
          <p className="text-sm leading-6 text-slate-500">编辑本页完整结构，明确应用后才更新向导与预览。不是后端保存格式，也不会改写正式助手输入输出契约。</p>
          <label className="block space-y-2 text-sm font-semibold text-slate-700">本页设计结构<textarea rows={24} spellCheck={false} className={control + " resize-y bg-slate-950 font-mono text-xs text-slate-100"} value={editor ?? serialized} onChange={(event) => { setEditor(event.target.value); setFeedback(null); }} /></label>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={formatEditor}>格式化配置</Button><Button type="button" onClick={applyEditor}>应用到本页草稿</Button></div>
          <p className="text-xs leading-5 text-slate-500">无效配置不会覆盖已有设计。未应用填写在切换模式前会要求确认。</p>
        </section>}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={checkDraft}><Check aria-hidden="true" className="size-4" />检查草稿</Button>
            <Button type="button" variant="secondary" onClick={() => { previewRef.current?.focus(); previewRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }}><Eye aria-hidden="true" className="size-4" />预览布局</Button>
            <Button type="button" disabled><FileText aria-hidden="true" className="size-4" />保存页面配置（待接入）</Button></div>
          <p className="text-xs leading-5 text-slate-500">仅当前页面临时保留。切换上方分区不会清除，关闭或刷新页面会丢失；没有写入浏览器存储、服务器或已发布工具。</p>
        </div>
      </div>
      <div ref={previewRef} tabIndex={-1} className="min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 xl:sticky xl:top-5">
        <WebToolLayoutPreview key={previewSession} draft={draft} values={previewValues} onValueChange={(id, value) => { setPreviewValues((current) => ({ ...current, [id]: value })); setDirty(true); setFeedback(null); }} />
      </div>
    </div>
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }}
      title={confirmation?.action === "clear" ? "确认清空页面设计？" : confirmation?.action === "discard-editor" ? "确认返回向导？" : confirmation?.action === "replace-inputs" ? "确认替换输入项？" : "确认移除设计项目？"}
      description={confirmationText} confirmLabel={confirmation?.action === "discard-editor" ? "丢弃未应用修改" : confirmation?.action === "replace-inputs" ? "替换输入项" : confirmation?.action === "clear" ? "清空本页草稿" : "移除"}
      onConfirm={confirmChange} returnFocusRef={returnFocusRef} tone="warning" />
  </div>;
}
