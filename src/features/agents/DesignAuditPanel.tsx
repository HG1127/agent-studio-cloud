"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { AuditFixActionResult, type AuditIssueView } from "@/contracts/audit";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { applyAuditFixesAction } from "@/server/actions/apply-audit-fixes";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";

function userText(value: string): string {
  return value
    .replaceAll("Child Workflow", "子流程")
    .replaceAll("Agent Team", "助手团队")
    .replaceAll("Harness/Policy", "系统安全策略")
    .replaceAll("businessSpec", "业务规格")
    .replaceAll("registryTool", "已注册业务工具")
    .replaceAll("scope", "权限范围")
    .replaceAll("Blueprint", "业务蓝图")
    .replaceAll("Checkpoint", "恢复点")
    .replaceAll("Schema", "字段结构")
    .replaceAll("Loop", "逐项处理")
    .replaceAll("Workflow", "流程")
    .replaceAll("Agent", "助手")
    .replaceAll("AI", "智能助手");
}

const severityLabels = { critical: "阻塞问题", warning: "待复核", info: "改进建议" } satisfies Record<AuditIssueView["severity"], string>;
const severityTones = { critical: "bg-red-50 text-red-700", warning: "bg-amber-50 text-amber-800", info: "bg-blue-50 text-blue-700" };
type FixResult = Extract<AuditFixActionResult, { ok: true }>;

export function DesignAuditPanel({ agentId, score, issues }: { agentId: string; score: number; issues: AuditIssueView[] }) {
  const router = useRouter();
  const searchId = useId();
  const severityId = useId();
  const fixabilityId = useId();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [reading, startReading] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<FixResult | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<"all" | AuditIssueView["severity"]>("all");
  const [fixability, setFixability] = useState<"all" | "automatic" | "manual">("all");
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);
  const automaticCount = issues.filter((issue) => issue.fixable).length;
  const hasFilters = Boolean(query.trim()) || severity !== "all" || fixability !== "all";
  const matchingIssues = issues.filter((issue) =>
    (severity === "all" || issue.severity === severity)
    && (fixability === "all" || issue.fixable === (fixability === "automatic"))
    && (!query.trim() || userText(issue.title + " " + issue.detail).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  );
  const visibleIssues = expanded ? matchingIssues : matchingIssues.slice(0, 8);
  const disabled = pending || reading || hasUnsavedDraft || uncertain;

  useEffect(() => {
    const receiveDraftState = (event: Event) => {
      const detail = (event as CustomEvent<DraftStateDetail>).detail;
      if (detail?.agentId !== agentId) return;
      dirtyRef.current = detail.dirty;
      setHasUnsavedDraft(detail.dirty);
      if (detail.dirty && !pendingRef.current) setConfirmOpen(false);
    };
    window.addEventListener(DRAFT_STATE_EVENT, receiveDraftState);
    return () => window.removeEventListener(DRAFT_STATE_EVENT, receiveDraftState);
  }, [agentId]);

  function reread() {
    if (pendingRef.current || reading) return;
    startReading(() => {
      setUncertain(false);
      setError(null);
      router.refresh();
    });
  }

  async function applyFixes() {
    if (pendingRef.current || dirtyRef.current || reading || uncertain) return;
    pendingRef.current = true;
    setPending(true);
    setResult(null);
    setError(null);
    try {
      const parsed = AuditFixActionResult.safeParse(await applyAuditFixesAction(agentId));
      if (!parsed.success) throw new Error("Invalid audit fix response");
      if (parsed.data.ok) {
        setResult(parsed.data);
        startReading(() => router.refresh());
      } else setError(userText(parsed.data.error));
    } catch {
      setUncertain(true);
      setError("暂时无法确认安全修复是否完成。请先重新读取设计检查，核对已保存流程，再决定是否重试；重新读取不会证明上次请求是否成功。");
    } finally {
      pendingRef.current = false;
      setPending(false);
      setConfirmOpen(false);
    }
  }

  function clearFilters() { setQuery(""); setSeverity("all"); setFixability("all"); setExpanded(false); }

  return <section id="audit" aria-labelledby="audit-heading" aria-busy={pending || reading} className="scroll-mt-32 rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="audit-heading" className="text-sm font-semibold text-slate-950">设计检查</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">已保存流程得分 {score}，发布前必须解决所有阻塞问题。</p>
        <p className="text-xs leading-5 text-slate-500">只检查已保存草稿，不代表试运行或业务验收通过。</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || reading} onClick={reread} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {reading ? "正在读取设计检查…" : "重新读取设计检查"}
        </button>
        {automaticCount > 0 ? <button ref={triggerRef} type="button" disabled={disabled} onClick={() => setConfirmOpen(true)} className="rounded-lg border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50">
          {pending ? "正在修复…" : hasUnsavedDraft ? "保存后再修复" : uncertain ? "重新读取后再修复" : "应用安全修复"}
        </button> : null}
      </div>
    </div>
    {hasUnsavedDraft ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">下方检查基于已保存流程；本页未保存的修改尚未重新检查。请先保存并刷新，再判断问题是否仍存在。{automaticCount > 0 ? "保存后才能应用安全修复。" : ""}</p> : null}
    <dl aria-label="设计问题概览" className="mt-4 grid grid-cols-3 gap-2">
      {(["critical", "warning", "info"] as const).map((level) => <div key={level} className={`rounded-lg p-3 ${severityTones[level]}`}>
        <dt className="text-xs font-medium">{severityLabels[level]}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{issues.filter((issue) => issue.severity === level).length}</dd>
      </div>)}
    </dl>
    {issues.length > 0 ? <>
      <p className="mt-3 text-xs leading-5 text-slate-600">共 {issues.length} 项问题，其中 {automaticCount} 项标记为可尝试自动修复、{issues.length - automaticCount} 项需人工处理。是否实际修复，以后端返回结果为准。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-5 text-slate-600">
        <p>当前检查结果未提供具体步骤关联，请根据问题说明在画布中人工核对。</p>
        <a href="#workflow" className="rounded-md px-2 py-1 font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">查看当前流程</a>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><label htmlFor={searchId} className="block text-xs font-medium text-slate-700">查找设计问题</label>
          <input id={searchId} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setExpanded(false); }} placeholder="按问题或说明查找" className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-3 text-sm" /></div>
        <div><label htmlFor={severityId} className="block text-xs font-medium text-slate-700">问题级别</label>
          <select id={severityId} value={severity} onChange={(event) => { setSeverity(event.target.value as typeof severity); setExpanded(false); }} className="mt-1 h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="all">全部级别</option>{(["critical", "warning", "info"] as const).map((level) => <option key={level} value={level}>{severityLabels[level]}</option>)}
          </select></div>
        <div><label htmlFor={fixabilityId} className="block text-xs font-medium text-slate-700">处理方式</label>
          <select id={fixabilityId} value={fixability} onChange={(event) => { setFixability(event.target.value as typeof fixability); setExpanded(false); }} className="mt-1 h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="all">全部方式</option><option value="automatic">可尝试自动修复</option><option value="manual">需人工处理</option>
          </select></div>
        {hasFilters ? <button type="button" onClick={clearFilters} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50">清除筛选</button> : null}
      </div>
      <p role="status" className="mt-2 text-xs text-slate-500">符合筛选 {matchingIssues.length} 项，当前显示 {visibleIssues.length} 项。筛选只影响展示，不改变自动修复范围。</p>
      {matchingIssues.length > 0 ? <ul aria-label="设计问题列表" className="mt-3 space-y-2">
        {visibleIssues.map((issue) => <li key={issue.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className={`rounded px-2 py-0.5 text-xs font-medium ${severityTones[issue.severity]}`}>{severityLabels[issue.severity]}</span>
            <span className="text-xs text-slate-500">{issue.fixable ? "可尝试自动修复" : "需人工处理"}</span></div>
          <p className="mt-2 break-words font-medium text-slate-900">{userText(issue.title)}</p>
          <p className="mt-1 break-words text-xs leading-5 text-slate-600">{userText(issue.detail)}</p>
        </li>)}
      </ul> : <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-sm text-slate-600">没有符合筛选的设计问题；这不代表流程没有其他问题。<button type="button" onClick={clearFilters} className="ml-2 font-semibold text-blue-700 hover:underline">查看全部问题</button></div>}
      {matchingIssues.length > 8 ? <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-3 rounded-md px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
        {expanded ? "收起其他问题" : `查看其他 ${matchingIssues.length - 8} 项问题`}
      </button> : null}
    </> : <p className="mt-3 text-sm text-emerald-700">当前设计检查通过。</p>}
    {result ? <section aria-label="本次修复返回结果" className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <h3 className="text-sm font-semibold text-slate-900">本次修复返回结果</h3>
      <p role="status" className="mt-1 text-sm leading-6 text-blue-800">{result.unchanged ? "本次没有写入新的修复。" : `已完成 ${result.applied.length} 项安全修复。`} 后端报告剩余 {result.remainingCritical} 个阻塞问题、{result.remainingWarnings} 个待复核问题。</p>
      <p className="mt-1 text-xs leading-5 text-slate-600">这是本次请求返回的结果，不是发布或运行结果。请结合重新读取后的问题列表核对；已发布版本不会被本次草稿修复改动。</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div><h4 className="text-xs font-semibold text-emerald-800">已完成的修复（{result.applied.length}）</h4>{result.applied.length ? <ul aria-label="已完成的修复" className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-slate-700">{result.applied.map((item, index) => <li key={index} className="break-words">{userText(item)}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">后端没有返回已完成的修复条目。</p>}</div>
        <div><h4 className="text-xs font-semibold text-amber-800">未完成的自动修复（{result.skipped.length}）</h4>{result.skipped.length ? <ul aria-label="未完成的自动修复" className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-slate-700">{result.skipped.map((item, index) => <li key={index} className="break-words">{userText(item)}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">后端没有返回跳过的修复条目；不代表全部设计问题都已解决。</p>}</div>
      </div>
    </section> : null}
    {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-700">{error}</p> : null}
    <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title="确认应用安全修复" description="后端将处理最新已保存流程中的全部可自动修复问题，不限于当前筛选结果。这可能补充默认路径、调整步骤配置或交付设置；不会修改已发布版本。当前没有逐条修复预览，请确认后再继续。" confirmLabel="确认修复已保存流程" onConfirm={() => { void applyFixes(); }} pending={pending} tone="warning" returnFocusRef={triggerRef} />
  </section>;
}
