"use client";

import { BrainCircuit, ClipboardCheck, Settings2, ShieldCheck } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import type { z } from "zod";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CapabilityNotice } from "@/components/ui/CapabilityNotice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyDraftState } from "@/lib/draft-state";
import {
  HarnessRuntimeDraft, HarnessRuleDesignDraft, emptyRuntimeDraft, emptyRuleDesignDraft,
  hasLocalDraft, draftErrors, runtimeDraftSummary, ruleDesignSummary,
  recoveryOptions, reviewerOptions, plannerOptions, choiceOptions,
  effectOptions, stepOptions, roleOptions, environmentOptions,
} from "./harness-runtime-draft";

function focusField(form: HTMLFormElement | null, name: string | undefined) {
  if (!form || !name) return;
  const field = form.elements.namedItem(name);
  if (!(field instanceof HTMLElement)) return;
  const disclosure = field.closest("details");
  if (disclosure) disclosure.open = true;
  field.focus();
}

function useLocalDraft<T extends Record<string, string>>(blank: () => T, schema: z.ZodType<T>, scope: string,
  checkRef: RefObject<HTMLButtonElement | null>, returnFocusRef: RefObject<HTMLButtonElement | null>) {
  const id = useId();
  const key = `${scope}:${id}`;
  const [draft, setDraft] = useState<T>(blank);
  const [checkpoint, setCheckpoint] = useState<T>(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<"undo" | "clear" | null>(null);
  const dirty = Object.values(draft).some((value) => value !== "");
  const canUndo = JSON.stringify(draft) !== JSON.stringify(checkpoint);

  useLayoutEffect(() => { notifyDraftState({ agentId: key, dirty }); }, [key, dirty]);
  useLayoutEffect(() => () => { notifyDraftState({ agentId: key, dirty: false }); }, [key]);
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(name: keyof T, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
    setMessage("");
    setErrors((current) => {
      const next = { ...current };
      delete next[String(name)];
      return next;
    });
  }
  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = schema.safeParse(draft);
    if (!result.success) {
      const nextErrors = draftErrors(result.error.issues);
      setErrors(nextErrors);
      setMessage("草稿还有填写问题，请按提示修改；尚未保存或生效。");
      focusField(event.currentTarget, Object.keys(nextErrors)[0]);
      return;
    }
    setCheckpoint({ ...draft });
    setErrors({});
    setMessage("本地草稿检查通过，仅说明填写符合本页要求；未保存，也未改变任何运行。");
  }
  function requestDiscard(kind: "undo" | "clear", target: HTMLButtonElement) {
    returnFocusRef.current = target;
    setConfirmation(kind);
  }
  function discard() {
    if (confirmation === null) return;
    const next = confirmation === "clear" ? blank() : { ...checkpoint };
    setDraft(next);
    if (confirmation === "clear") setCheckpoint(blank());
    setErrors({});
    setMessage(confirmation === "clear" ? "本页草稿已清空，系统配置没有变化。" : "已撤销到本页上次检查的草稿；没有检查记录时回到空白。系统配置没有变化。");
    returnFocusRef.current = checkRef.current;
    setConfirmation(null);
  }
  return { draft, errors, message, confirmation, dirty, canUndo, change, check, requestDiscard, discard, setConfirmation };
}

const fieldClass = "h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 aria-invalid:border-red-400";
function DraftField({ name, label, value, hint, error, options, onChange, maxLength = 12 }: {
  name: string; label: string; value: string; hint: string; error?: string;
  options?: readonly { value: string; label: string }[];
  onChange: (value: string) => void; maxLength?: number;
}) {
  const id = useId();
  const describedBy = `${id}-hint${error ? ` ${id}-error` : ""}`;
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm font-medium text-slate-800">{label}</label>
    {options ? <select id={id} name={name} value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} className={fieldClass}>
      <option value="">请选择</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : <input id={id} name={name} value={value} onChange={(event) => onChange(event.target.value)} type="text" inputMode={name === "name" ? "text" : "numeric"} maxLength={maxLength} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={describedBy} className={fieldClass} />}
    <p id={`${id}-hint`} className="text-xs leading-5 text-slate-500">{hint}</p>
    {error ? <p id={`${id}-error`} className="text-xs text-red-700">{error}</p> : null}
  </div>;
}

function SettingSection({ title, icon, children, description }: { title: string; icon: ReactNode; children: ReactNode; description?: string }) {
  return <section className="space-y-4 border-b border-slate-100 pb-6 last:border-0 last:pb-0">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><span aria-hidden="true" className="text-indigo-600">{icon}</span>{title}</h3>
    {description ? <p className="text-xs leading-5 text-slate-500">{description}</p> : null}
    <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2">{children}</div>
  </section>;
}

function DraftSummary({ title, lines, empty }: { title: string; lines: string[]; empty: boolean }) {
  return <Card className="min-w-0 self-start lg:sticky lg:top-5">
    <CardHeader><CardTitle>{title}</CardTitle><p className="text-xs leading-5 text-slate-500">这是设计摘要，不是执行结果或已生效配置。</p></CardHeader>
    <CardContent className="space-y-4">
      {empty ? <p className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-500">尚未填写。未接入的配置不预填系统默认值。</p> : <ul className="space-y-3 text-sm leading-6 text-slate-700">{lines.map((line) => <li className="break-words" key={line}>{line}</li>)}</ul>}
      <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-amber-800">仅保留在当前页面；刷新或离开后不会自动恢复。不向服务器提交，也不会改变任务。</p>
    </CardContent>
  </Card>;
}

export function RuntimeDefaultsDraft() {
  const checkRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const state = useLocalDraft(emptyRuntimeDraft, HarnessRuntimeDraft, "harness-runtime-defaults-draft", checkRef, returnFocusRef);
  const field = (name: keyof HarnessRuntimeDraft, label: string, hint: string, options?: readonly { value: string; label: string }[]) => <DraftField name={name} label={label} hint={hint} value={state.draft[name]} error={state.errors[name]} options={options} onChange={(value) => state.change(name, value)} />;
  return <div className="min-w-0 space-y-5">
    <CapabilityNotice mode="draft" title="默认运行规则：仅本页草稿">统一默认规则的读取和保存尚未接入。本页可以填写、检查和撤销；检查通过不代表已经保存，也不会影响新任务或正在运行的任务。</CapabilityNotice>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="min-w-0">
        <CardHeader><CardTitle>默认运行规则草稿</CardTitle><p className="text-sm leading-6 text-slate-500">设计执行与失败处理、记忆使用和质量抽查。所有字段从空白开始，请按需要选择。</p></CardHeader>
        <CardContent>
          <form noValidate onSubmit={state.check} aria-label="默认运行规则草稿" className="space-y-6">
            <SettingSection title="执行与失败处理" icon={<Settings2 className="size-4" />}>
              {field("recovery", "步骤失败时怎么处理", "设计可重试错误的处理方式；安全拦截不应被重试绕过。", recoveryOptions)}
              {field("reviewer", "怎样检查交付结果", "按交付要求检查；不能保证识别所有事实错误。", reviewerOptions)}
            </SettingSection>
            <SettingSection title="记忆使用" icon={<BrainCircuit className="size-4" />} description="设计可参考的记忆容量；这些选择不会触发检索、改动记忆或授权。">
              {field("memoryItems", "每次最多参考多少条记忆", "0–20 条；设计为 0 时不参考长期记忆。")}
              {field("memoryChars", "记忆内容上限（字符）", "0–20,000 字符；接入后还需与整体上下文容量共同检查。")}
              {field("blockSensitive", "拦截疑似敏感内容", "检测能力仍需服务端接入；不是完整的数据分类审查。", choiceOptions)}
            </SettingSection>
            <SettingSection title="质量抽查" icon={<ClipboardCheck className="size-4" />} description="设计运行后的持续评估，不替代任务交付检查，也不会生成评估记录。">
              {field("samplingRate", "常规任务抽查比例（%）", "0–100 的整数；表示设计中的抽查比例。")}
              {field("evaluateFailures", "失败任务始终评估", "即使常规抽查比例较低，是否仍评估失败任务。", choiceOptions)}
              {field("evaluateHuman", "涉及人工确认的任务始终评估", "是否对有人工确认的任务单独安排评估。", choiceOptions)}
              {field("regressionCandidate", "未通过评估的任务加入回归候选", "这里只设计候选规则，不会创建样例或回归任务。", choiceOptions)}
            </SettingSection>
            <details className="rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">高级设置：计划与上下文容量</summary>
              <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
                {field("planner", "如何生成执行计划", "按流程路径设计；标记高风险不等于自动重排步骤。", plannerOptions)}
                {field("contextChars", "上下文上限（字符）", "2,000–60,000 的整数；不是当前模型请求的实际占用。")}
              </div>
            </details>
            {state.message ? <p role={Object.keys(state.errors).length ? "alert" : "status"} className={`rounded-lg p-3 text-sm leading-6 ${Object.keys(state.errors).length ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"}`}>{state.message}</p> : null}
            <div className="space-y-3 border-t border-slate-100 pt-5">
              <p className="text-xs leading-5 text-slate-500">撤销到本页上次检查；没有检查记录时回到空白。检查后仍是未保存草稿。</p>
              <div className="flex flex-wrap gap-2">
                <button ref={checkRef} type="submit" className={buttonVariants()}>检查草稿</button>
                <Button type="button" variant="secondary" disabled={!state.canUndo} onClick={(event) => state.requestDiscard("undo", event.currentTarget)}>撤销修改</Button>
                <Button type="button" variant="ghost" disabled={!state.dirty} onClick={(event) => state.requestDiscard("clear", event.currentTarget)}>清空草稿</Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <DraftSummary title="本地影响摘要" lines={runtimeDraftSummary(state.draft)} empty={!hasLocalDraft(state.draft)} />
    </div>
    <ConfirmDialog open={state.confirmation !== null} onOpenChange={(open) => { if (!open) state.setConfirmation(null); }} title={state.confirmation === "undo" ? "确认撤销草稿修改" : "确认清空默认规则草稿"} description={state.confirmation === "undo" ? "撤销到本页上次检查的草稿；没有检查记录时回到空白。之后的填写将丢弃，不影响任何系统配置。" : "当前填写和本页检查记录将丢弃，不会清除服务器规则或改变运行中的任务。"} confirmLabel={state.confirmation === "undo" ? "确认撤销" : "确认清空草稿"} onConfirm={state.discard} tone="warning" returnFocusRef={returnFocusRef} />
  </div>;
}

export function RuleConditionsDraft() {
  const checkRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const state = useLocalDraft(emptyRuleDesignDraft, HarnessRuleDesignDraft, "harness-rule-conditions-draft", checkRef, returnFocusRef);
  const field = (name: keyof HarnessRuleDesignDraft, label: string, hint: string, options?: readonly { value: string; label: string }[]) => <DraftField name={name} label={label} hint={hint} value={state.draft[name]} error={state.errors[name]} options={options} maxLength={100} onChange={(value) => state.change(name, value)} />;
  return <div className="min-w-0 space-y-5">
    <CapabilityNotice mode="draft" title="其他规则效果与身份环境：待接入">下方只设计条件。人工确认、仅记录以及身份环境模拟尚未接入，不会生成审批、规则判决或模拟结果。上方现有规则与精确试算继续使用真实接口。</CapabilityNotice>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card className="min-w-0">
        <CardHeader><CardTitle>高级规则设计</CardTitle><p className="text-sm leading-6 text-slate-500">先填写希望限制的步骤和处理方式，再选择需要核对的身份与环境。</p></CardHeader>
        <CardContent>
          <form noValidate onSubmit={state.check} aria-label="高级规则设计草稿" className="space-y-6">
            <SettingSection title="触发条件与处理方式" icon={<ShieldCheck className="size-4" />}>
              {field("name", "草稿规则名称", "只用于本地设计，最多 100 个字符。")}
              {field("step", "设计中的步骤范围", "选择规则希望覆盖的步骤；不代表当前保存接口支持全部类型。", stepOptions)}
              {field("effect", "设计中的处理方式", "选择后右侧显示设计意图，不会实际暂停、拦截或放行动作。", effectOptions)}
            </SettingSection>
            <details className="rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">身份与环境模拟条件</summary>
              <p className="mt-3 text-xs leading-5 text-slate-500">可先选择需要模拟的条件；目前没有提交或返回运行判决的接口，不会重跑任务或调用工具。</p>
              <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-2">
                {field("role", "待模拟身份", "只选择条件，不更改实际身份或权限。", roleOptions)}
                {field("environment", "待模拟环境", "只选择条件，不切换实际环境或连接。", environmentOptions)}
              </div>
            </details>
            {state.message ? <p role={Object.keys(state.errors).length ? "alert" : "status"} className={`rounded-lg p-3 text-sm leading-6 ${Object.keys(state.errors).length ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"}`}>{state.message}</p> : null}
            <p className="text-xs leading-5 text-slate-500">撤销到本页上次检查，不是已保存的系统规则。</p>
            <div className="flex flex-wrap gap-2">
              <button ref={checkRef} type="submit" className={buttonVariants()}>检查规则设计</button>
              <Button type="button" variant="secondary" disabled={!state.canUndo} onClick={(event) => state.requestDiscard("undo", event.currentTarget)}>撤销规则设计</Button>
              <Button type="button" variant="ghost" disabled={!state.dirty} onClick={(event) => state.requestDiscard("clear", event.currentTarget)}>清空规则设计</Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <DraftSummary title="规则设计摘要" lines={ruleDesignSummary(state.draft)} empty={!hasLocalDraft(state.draft)} />
    </div>
    <ConfirmDialog open={state.confirmation !== null} onOpenChange={(open) => { if (!open) state.setConfirmation(null); }} title={state.confirmation === "undo" ? "确认撤销规则设计" : "确认清空规则设计"} description={state.confirmation === "undo" ? "回到本页上次检查的设计；没有检查记录时回到空白。不修改实际安全规则。" : "丢弃本页规则和模拟条件的填写，不会撤销服务器规则、审批或权限。"} confirmLabel={state.confirmation === "undo" ? "确认撤销设计" : "确认清空设计"} onConfirm={state.discard} tone="warning" returnFocusRef={returnFocusRef} />
  </div>;
}
