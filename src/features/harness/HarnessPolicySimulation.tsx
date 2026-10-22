"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type HarnessPolicy } from "@/contracts/harness";
import { HarnessSimulationInput, HarnessSimulationResult, HarnessSimulationSubject } from "@/contracts/harness-simulation";
import { simulateHarnessPolicyAction } from "@/server/actions/simulate-harness-policy";

const fieldClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50";

export function HarnessPolicySimulation({ policy, enabled }: { policy: HarnessPolicy; enabled: boolean }) {
  const source = JSON.stringify(policy);
  const [nodeType, setNodeType] = useState<"ai" | "tool">("tool");
  const [nodeId, setNodeId] = useState("");
  const [risk, setRisk] = useState<"low" | "medium" | "high" | undefined>();
  const [registryToolId, setRegistryToolId] = useState("");
  const [scope, setScope] = useState("");
  const [state, setState] = useState<{ source: string; pending: boolean; displaced: boolean; result: HarnessSimulationResult | null; error: string | null }>({ source, pending: false, displaced: false, result: null, error: null });
  const active = useRef<number | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  if (state.source !== source) setState({ ...state, source, displaced: true, result: null, error: "规则填写已变化，原试算结果已清除。请重新核对条件后试算。" });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current = null; }; }, []);

  function changed() {
    active.current = null;
    setState({ source, pending: false, displaced: false, result: null, error: null });
  }
  async function simulate() {
    if (!enabled || active.current !== null) return;
    const parsed = HarnessSimulationInput.safeParse({ policy, subjects: [{ nodeType, nodeId,
      ...(risk ? { risk } : {}), ...(registryToolId ? { registryToolId } : {}), ...(scope ? { scope } : {}),
    }] });
    if (!parsed.success) { setState({ source, pending: false, displaced: false, result: null, error: "请在技术条件中填写步骤标识，并核对规则和条件长度。试算只接收共享契约允许的数据。" }); return; }
    const ticket = ++sequence.current; active.current = ticket;
    setState({ source, pending: true, displaced: false, result: null, error: null });
    try {
      const response = HarnessSimulationResult.safeParse(await simulateHarnessPolicyAction(parsed.data));
      if (!mounted.current || active.current !== ticket) return;
      const valid = response.success && response.data.ok && response.data.decisions.length === 1
        && response.data.decisions.every((decision) => decision.matchedRuleIndex === null || decision.matchedRuleIndex < policy.rules.length);
      setState((previous) => previous.displaced || previous.source !== source
        ? { ...previous, pending: false, result: null }
        : { source, pending: false, displaced: false, result: valid && response.success ? response.data : null, error: valid ? null : "试算结果暂时无法核对，没有按允许或无命中处理。请检查条件后手动重试。" });
    } catch {
      if (mounted.current && active.current === ticket) setState((previous) => ({ ...previous, pending: false, result: null, error: "试算暂时无法读取，判断未知。未保存规则、启动任务或调用业务工具。" }));
    } finally { if (active.current === ticket) active.current = null; }
  }
  const decision = state.result?.ok ? state.result.decisions[0] : null;

  return <section aria-labelledby="harness-draft-simulation-title" className="mt-6 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
    <h3 id="harness-draft-simulation-title" className="text-sm font-semibold text-slate-900">试算当前填写的安全规则</h3>
    <p className="mt-1 text-xs leading-5 text-slate-500">用一组明确条件向服务端核对当前填写与管理员限制。只计算允许或阻止，不保存规则、不运行任务、不调用模型或业务工具；不是历史任务判决，也不是旧版身份或环境模拟。</p>
    <fieldset disabled={!enabled || state.pending} className="mt-3 grid gap-3 md:grid-cols-2">
      <label className="block text-xs font-medium text-slate-700">试算步骤类型<select className={fieldClass} value={nodeType} onChange={(event) => { const parsed = HarnessSimulationSubject.shape.nodeType.safeParse(event.target.value); if (parsed.success) { setNodeType(parsed.data); changed(); } }}><option value="tool">外部工具</option><option value="ai">智能处理</option></select></label>
      <label className="block text-xs font-medium text-slate-700">试算风险等级<select className={fieldClass} value={risk ?? ""} onChange={(event) => { const parsed = HarnessSimulationSubject.shape.risk.safeParse(event.target.value || undefined); if (parsed.success) { setRisk(parsed.data ?? undefined); changed(); } }}><option value="">未提供风险等级</option><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label>
      <details className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 md:col-span-2"><summary className="cursor-pointer text-xs font-semibold text-slate-700">试算技术条件（开发者）</summary><p className="mt-2 text-xs leading-5 text-slate-500">步骤标识必填，按提供的原值精确判断，不自动猜测。可填真实流程标识或明确自拟的试算条件；自拟条件不代表任何真实任务。工具与授权范围留空表示未提供，不等于已授权。</p><div className="mt-2 grid gap-3 md:grid-cols-3">
        <label className="block text-xs text-slate-700">试算 nodeId<input className={fieldClass} maxLength={200} value={nodeId} autoComplete="off" onChange={(event) => { setNodeId(event.target.value); changed(); }} /></label>
        <label className="block text-xs text-slate-700">试算 registryToolId<input className={fieldClass} maxLength={200} value={registryToolId} autoComplete="off" onChange={(event) => { setRegistryToolId(event.target.value); changed(); }} /></label>
        <label className="block text-xs text-slate-700">试算 scope<input className={fieldClass} maxLength={200} value={scope} autoComplete="off" onChange={(event) => { setScope(event.target.value); changed(); }} /></label>
      </div></details>
    </fieldset>
    <div className="mt-3 flex flex-wrap gap-3"><Button type="button" variant="secondary" disabled={!enabled || state.pending} onClick={() => void simulate()}>核对草稿命中结果</Button>{state.pending ? <Button type="button" variant="ghost" onClick={() => { active.current = null; setState({ source, pending: false, displaced: false, result: null, error: "已停止显示本次试算，迟到结果不再展示。这不会取消服务端已发出的只读计算。" }); }}>停止显示本次试算</Button> : null}</div>
    {state.pending ? <p role="status" className="mt-3 text-sm text-indigo-900">{state.displaced ? "规则填写已经变化，原试算不再用于判断。可等待返回或停止显示后重新试算。" : "正在核对服务端草稿判决…"}</p> : null}
    {state.error ? <p role="alert" className="mt-3 text-sm leading-6 text-amber-900">{state.error}</p> : null}
    {decision ? <div role="status" className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6"><p className="font-semibold text-slate-900">{decision.invalid ? "配置无效，试算阻止" : decision.allowed ? "本组条件允许继续" : "本组条件被阻止"}</p><p className="text-slate-600">{decision.invalid ? "服务端规则配置无法核对，已按安全边界阻止；这不是正常的命中或未命中，请先核对配置。" : decision.source === "administrator" ? "管理员规则限制，不能通过当前工作区填写放宽。" : decision.matchedRuleIndex === null ? "工作区附加规则未命中，不代表工具已授权或任务一定能完成。" : `命中当前填写的工作区第 ${decision.matchedRuleIndex + 1} 条规则。`}此结果只对应这次提交的条件与规则；不说明规则已保存或真实任务已经执行。</p></div> : null}
  </section>;
}
