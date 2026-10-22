"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HarnessPolicyRule, type HarnessPolicy } from "@/contracts/harness";
import { HarnessPolicyReadResult, HarnessPolicySaveResult, type HarnessPolicyView, type HarnessPolicySaveInput } from "@/contracts/harness-management";
import { notifyDraftState } from "@/lib/draft-state";
import { saveHarnessPolicyAction } from "@/server/actions/save-harness-policy";
import { harnessDraftMatches, harnessDraftRequest, newHarnessRule, normalizedHarnessDraft } from "./harness-policy-draft";
import { HarnessPolicySimulation } from "./HarnessPolicySimulation";

const EMPTY_POLICY: HarnessPolicy = { version: 1, rules: [] };
const fieldClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50";

interface PolicyReadState {
  source: HarnessPolicyReadResult;
  read: HarnessPolicyReadResult;
  highest: HarnessPolicyView | null;
}

function acceptRead(previous: PolicyReadState, incoming: HarnessPolicyReadResult, receipt = false): PolicyReadState {
  if (!incoming.ok) return { ...previous, read: incoming };
  const highest = previous.highest;
  if (highest && (incoming.policy.revision < highest.revision
    || (incoming.policy.revision === highest.revision && JSON.stringify(incoming.policy) !== JSON.stringify(highest)))) {
    return receipt ? previous : { ...previous, read: { ok: false, error: "读取结果无法与已确认版本核对，请重新读取。" } };
  }
  return { ...previous, read: incoming, highest: incoming.policy };
}

export function WorkspacePolicyPanel({ initialRead }: { initialRead: HarnessPolicyReadResult }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [readState, setReadState] = useState<PolicyReadState>(() => ({ source: initialRead, read: initialRead, highest: initialRead.ok ? initialRead.policy : null }));
  const read = readState.read;
  const [base, setBase] = useState<HarnessPolicyView | null>(() => initialRead.ok ? initialRead.policy : null);
  const [draft, setDraft] = useState<HarnessPolicy>(() => initialRead.ok ? initialRead.policy.policy ?? EMPTY_POLICY : EMPTY_POLICY);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState<HarnessPolicySaveInput | null>(null);
  const [retryConfirmation, setRetryConfirmation] = useState(false);
  const [request, setRequest] = useState<HarnessPolicySaveInput | null>(null);
  const [outcome, setOutcome] = useState<HarnessPolicySaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef<HarnessPolicySaveInput | null>(null);
  const writeLock = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const confirmationFocus = useRef<HTMLElement | null>(null);
  const retryFocus = useRef<HTMLElement | null>(null);

  if (readState.source !== initialRead) {
    const parsed = HarnessPolicyReadResult.safeParse(initialRead);
    setReadState((previous) => ({ ...acceptRead(previous, parsed.success ? parsed.data : { ok: false, error: "读取结果无法核对。" }), source: initialRead }));
    setConfirmation(null);
    setRetryConfirmation(false);
  }

  useEffect(() => {
    const mountedRef = mounted;
    const generationRef = generation;
    mountedRef.current = true;
    // 清理时递增最新计数，不能复制旧值后回写。
    return () => { mountedRef.current = false; generationRef.current++; };
  }, []);
  const uncertain = request !== null && (!outcome || (!outcome.ok && outcome.retryable === true));
  const dirty = base !== null && (!harnessDraftMatches(draft, base.policy) || reason.trim().length > 0);
  useEffect(() => {
    const protectedDraft = dirty || uncertain || saving;
    notifyDraftState({ agentId: "harness-workspace-policy", dirty: protectedDraft });
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    if (protectedDraft) window.addEventListener("beforeunload", warn);
    return () => {
      notifyDraftState({ agentId: "harness-workspace-policy", dirty: false });
      window.removeEventListener("beforeunload", warn);
    };
  }, [dirty, uncertain, saving]);

  const current = read.ok ? read.policy : null;
  const changed = current !== null && base !== null && current.revision !== base.revision;
  const canEdit = current !== null && base !== null && !request && !saving && !refreshing;
  const canSave = canEdit && !changed;

  function updateRule(index: number, next: HarnessPolicyRule) {
    setDraft((previous) => ({ ...previous, rules: previous.rules.map((rule, position) => position === index ? next : rule) }));
    setConfirmation(null);
    setError(null);
  }
  function beginLatest() {
    if (!current || saving || refreshing || uncertain) return;
    if (dirty && !window.confirm("当前填写将被最新已保存规则替换，确定放弃这些填写吗？")) return;
    setBase(current); setDraft(current.policy ?? EMPTY_POLICY); setReason(""); setError(null);
    setConfirmation(null); setOutcome(null); setRequest(null); requestRef.current = null;
  }
  function prepare(clear: boolean) {
    if (!canSave || !base || writeLock.current || requestRef.current) return;
    let requestId: string;
    try { requestId = crypto.randomUUID(); }
    catch { setError("当前无法创建安全的保存请求，请保留填写并稍后重试。"); return; }
    const parsed = harnessDraftRequest(clear ? null : draft, reason, base.revision, requestId);
    if (!parsed.success) {
      setError("请填写修改原因并核对规则：最多一百条，说明最多三百字，技术条件最多二百字。不要填写密钥。"); return;
    }
    setError(null); setConfirmation(parsed.data);
  }
  async function attempt(payload: HarnessPolicySaveInput) {
    if (writeLock.current) return;
    writeLock.current = true;
    const ticket = ++generation.current;
    setSaving(true); setOutcome(null);
    try {
      const parsed = HarnessPolicySaveResult.safeParse(await saveHarnessPolicyAction(payload));
      const result: HarnessPolicySaveResult = parsed.success && (!parsed.data.ok || (parsed.data.recordedRevision === payload.expectedRevision + 1
        && (parsed.data.policy.revision > parsed.data.recordedRevision || JSON.stringify(parsed.data.policy.policy) === JSON.stringify(payload.policy))))
        ? parsed.data : { ok: false, error: "保存回执无法核对，请保留原请求。", retryable: true };
      if (!mounted.current || ticket !== generation.current) return;
      setOutcome(result);
      if (result.ok) { setReadState((previous) => acceptRead(previous, { ok: true, policy: result.policy }, true)); setBase(result.policy); setDraft(payload.policy ?? EMPTY_POLICY); setReason(""); }
    } catch {
      if (mounted.current && ticket === generation.current) setOutcome({ ok: false, error: "保存结果尚未确认，请保留原请求。", retryable: true });
    } finally {
      if (mounted.current && ticket === generation.current) { writeLock.current = false; setSaving(false); }
    }
  }
  function confirmSave() {
    if (!confirmation || !canSave || !base || writeLock.current || requestRef.current || confirmation.expectedRevision !== base.revision) return;
    const latest = harnessDraftRequest(confirmation.policy === null ? null : draft, reason, base.revision, confirmation.requestId);
    if (!latest.success || JSON.stringify(latest.data) !== JSON.stringify(confirmation)) { setConfirmation(null); setError("填写已改变，请重新核对并确认。"); return; }
    const payload = confirmation;
    requestRef.current = payload; setRequest(payload); setConfirmation(null); void attempt(payload);
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const focus = document.activeElement; if (focus instanceof HTMLElement) confirmationFocus.current = focus; prepare(false); }

  return <section id="workspace-safety-policy" aria-labelledby="workspace-policy-title" className="content-card min-w-0 scroll-mt-24">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="workspace-policy-title" className="section-title flex items-center gap-2"><ShieldCheck aria-hidden className="size-5 text-indigo-600" />工作区安全规则</h2><p className="mt-1 text-sm leading-6 text-slate-500">读取真实规则，编辑后明确确认；保存时核对版本，避免覆盖他人的修改。</p></div>
      <Button type="button" variant="secondary" disabled={saving || refreshing} aria-busy={refreshing} onClick={() => { setConfirmation(null); setRetryConfirmation(false); startRefresh(() => router.refresh()); }}>{refreshing ? "正在读取规则…" : "重新读取安全规则"}</Button>
    </div>
    <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm leading-6 text-indigo-950">新根任务首次开始执行时冻结规则；子任务继承父任务已冻结的规则，已经冻结的任务不会被本页修改。多条命中时阻止优先，允许规则不能放宽管理员限制或工具授权。这里只管理允许与阻止，不提供未实现的人工审批、仅记录或优先级开关。</p>
    {refreshing ? <p role="status" className="mt-4 text-sm text-slate-600">正在重新核对规则；当前填写会保留，不能提交旧读数。</p> : !current ? <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">安全规则暂时无法读取，当前配置未知，不能按“没有规则”处理。其他运行诊断仍可查看。</p> : <div aria-label="本次安全规则读取" className="mt-4 rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">{current.source === "unconfigured" ? "尚未设置工作区附加规则" : current.source === "cleared" ? `工作区附加规则已清除 · 第 ${current.revision} 版` : `已保存 ${current.policy?.rules.length ?? 0} 条附加规则 · 第 ${current.revision} 版`}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{current.updatedAt ? `保存时间：${new Date(current.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）。` : "没有附加规则不代表没有安全检查。"}基础检查和管理员规则仍会执行。本次读取不是过去任务的冻结策略。</p>
    </div>}
    {changed ? <p role="alert" className="mt-3 text-sm leading-6 text-amber-900">已读取的规则版本发生变化，当前填写仍保留原版本，不能自动覆盖。请核对后按最新规则开始新修改。</p> : null}
    <form aria-label="编辑工作区安全规则" onSubmit={submit} className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-600">{base ? `本次编辑基于第 ${base.revision} 版` : "请先读取规则，再开始填写"}{dirty ? " · 有未保存填写" : ""}</p><Button type="button" variant="secondary" disabled={!canEdit || draft.rules.length >= 100} onClick={() => {
        try { const rule = newHarnessRule(crypto.randomUUID()); setDraft((previous) => ({ ...previous, rules: [...previous.rules, rule] })); setConfirmation(null); }
        catch { setError("当前无法创建规则，请保留原填写并稍后重试。"); }
      }}><Plus aria-hidden className="size-4" />添加安全规则</Button></div>
      <fieldset disabled={!canEdit} className="space-y-3">
        {draft.rules.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm leading-6 text-slate-500">{base ? "当前填写没有附加规则。可添加允许或阻止条件；保存空规则与清除工作区配置是不同操作。" : "尚未读到可编辑规则，不预填默认规则。"}</p> : draft.rules.map((rule, index) => <div key={rule.id} role="group" aria-label={`安全规则 ${index + 1}`} className="rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">安全规则 {index + 1}</h3><Button type="button" size="sm" variant="ghost" aria-label={`从填写中移除规则 ${index + 1}`} onClick={() => { setDraft((previous) => ({ ...previous, rules: previous.rules.filter((_, position) => position !== index) })); setConfirmation(null); }}><Trash2 aria-hidden className="size-4" />移除</Button></div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="block text-xs font-medium text-slate-700">处理方式<select className={fieldClass} value={rule.effect} onChange={(event) => { const parsed = HarnessPolicyRule.shape.effect.safeParse(event.target.value); if (parsed.success) updateRule(index, { ...rule, effect: parsed.data }); }}><option value="deny">阻止执行</option><option value="allow">允许继续（仍须通过其他检查）</option></select></label>
            <label className="block text-xs font-medium text-slate-700">步骤类型<select className={fieldClass} value={rule.when.nodeType ?? ""} onChange={(event) => { const parsed = HarnessPolicyRule.shape.when.shape.nodeType.safeParse(event.target.value || undefined); if (parsed.success) updateRule(index, { ...rule, when: { ...rule.when, nodeType: parsed.data } }); }}><option value="">任意受检步骤</option><option value="tool">外部工具</option><option value="ai">智能处理</option></select></label>
            <label className="block text-xs font-medium text-slate-700">风险等级<select className={fieldClass} value={rule.when.risk ?? ""} onChange={(event) => { const parsed = HarnessPolicyRule.shape.when.shape.risk.safeParse(event.target.value || undefined); if (parsed.success) updateRule(index, { ...rule, when: { ...rule.when, risk: parsed.data } }); }}><option value="">不限等级</option><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label>
          </div>
          <label className="mt-3 block text-xs font-medium text-slate-700">规则说明（选填）<textarea className={fieldClass} maxLength={300} value={rule.reason ?? ""} onChange={(event) => updateRule(index, { ...rule, reason: event.target.value })} /></label>
          <details className="mt-3 rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">技术条件（开发者）</summary><p className="mt-2 text-xs leading-5 text-slate-500">按原值精确匹配，不支持通配符。留空表示不限制此条件；所有填写条件须同时满足。</p><div className="mt-2 grid gap-3 md:grid-cols-3">{(["nodeId", "registryToolId", "scope"] as const).map((key) => <label key={key} className="block text-xs text-slate-700">{key}<input className={fieldClass} maxLength={200} autoComplete="off" value={rule.when[key] ?? ""} onChange={(event) => updateRule(index, { ...rule, when: { ...rule.when, [key]: event.target.value || undefined } })} /></label>)}</div></details>
          <p className="mt-3 text-xs leading-5 text-slate-500">{rule.effect === "deny" ? "匹配这些条件的受检步骤会被阻止。" : "匹配这些条件时，本条规则允许继续，但不能抵消其他阻止条件。"}{Object.values(rule.when).every((value) => !value) ? " 当前没有限制条件，会匹配所有受检步骤。" : ""}</p>
        </div>)}
        <label className="block text-sm font-medium text-slate-700">修改原因<textarea aria-label="安全规则修改原因" required maxLength={1000} className={fieldClass} value={reason} onChange={(event) => { setReason(event.target.value); setConfirmation(null); setError(null); }} placeholder="说明本次修改的业务原因，不要填写密码或密钥" /></label>
      </fieldset>
      {error ? <p role="alert" className="text-sm leading-6 text-amber-900">{error}</p> : null}
      {!request ? <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!canSave}>核对并保存安全规则</Button><Button type="button" variant="secondary" disabled={!canSave} onClick={(event) => { confirmationFocus.current = event.currentTarget; prepare(true); }}>清除工作区规则</Button><Button type="button" variant="ghost" disabled={!current || saving || refreshing} onClick={beginLatest}>按最新规则开始新修改</Button></div> : <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        {saving ? <p role="status" className="text-sm text-indigo-900">正在提交原请求并核对保存回执…</p> : outcome?.ok ? <p role="status" className="text-sm leading-6 text-emerald-900">这次请求已保存为第 {outcome.recordedRevision} 版。{outcome.policy.revision > outcome.recordedRevision ? `回执同时返回第 ${outcome.policy.revision} 版；原请求没有将旧规则重新设为当前值。` : "后续新任务会在开始时冻结读取到的规则。"}当前配置以上方本次读取为准，保存回执不覆盖已经读取的较新版本。</p> : outcome ? <p role="alert" className="text-sm leading-6 text-amber-900">{outcome.conflict ? "规则版本冲突，未按旧版本覆盖。请重新读取后明确重新填写。" : outcome.retryable ? "保存结果尚未确认。不能凭当前规则相同就认定原请求成功，也不能认定没有写入。" : "这次设置未被接受，请重新读取并核对规则和修改原因。"}</p> : null}
        <p className="mt-2 text-xs leading-5 text-slate-500">原请求的规则、原因与原版本只在此页面保留，不自动重发。离开或整页刷新将丢失原请求，请先核对结果。</p>
        <div className="mt-3 flex flex-wrap gap-3">{uncertain ? <Button type="button" variant="secondary" disabled={saving || refreshing} onClick={(event) => { retryFocus.current = event.currentTarget; setRetryConfirmation(true); }}>用原请求再次确认保存</Button> : <Button type="button" variant="secondary" disabled={!current || saving || refreshing} onClick={beginLatest}>按最新规则开始新修改</Button>}</div>
      </div>}
    </form>
    <HarnessPolicySimulation policy={normalizedHarnessDraft(draft)} enabled={canEdit} />
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title={confirmation?.policy === null ? "确认清除工作区规则" : "确认保存安全规则"} description={confirmation?.policy === null ? "将清除工作区附加配置，不会解除管理员规则、工具权限或已冻结任务的限制。修改原因和原版本会一并提交。" : `将整体保存当前填写的 ${confirmation?.policy?.rules.length ?? 0} 条规则与修改原因，按原版本核对。后续首次启动的根任务使用新规则，子任务继承父任务冻结规则，不改变已冻结任务。`} confirmLabel="确认提交这次修改" onConfirm={confirmSave} tone="warning" returnFocusRef={confirmationFocus} />
    <ConfirmDialog open={retryConfirmation} onOpenChange={setRetryConfirmation} title="确认沿用原请求" description="这是写入重试，不是只读查询。如果首次写入尚未发生，本次仍可能首次保存。只沿用完整原请求，不换规则、原因或版本，不创建另一次修改。" confirmLabel="确认重试原请求" onConfirm={() => { const payload = requestRef.current; if (!payload || writeLock.current) return; setRetryConfirmation(false); void attempt(payload); }} pending={saving} tone="warning" returnFocusRef={retryFocus} />
  </section>;
}
