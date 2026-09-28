"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuditIssueView } from "@/contracts/audit";
import { applyAuditFixesAction } from "@/server/actions/apply-audit-fixes";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";
import { requestWorkflowNodeFocus } from "@/lib/workflow-node-focus";

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

export function DesignAuditPanel({ agentId, score, issues }: { agentId: string; score: number; issues: AuditIssueView[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);
  const fixable = issues.some((issue) => issue.fixable);
  const visibleIssues = expanded ? issues : issues.slice(0, 8);
  useEffect(() => {
    const receiveDraftState = (event: Event) => {
      const detail = (event as CustomEvent<DraftStateDetail>).detail;
      if (detail?.agentId === agentId) setHasUnsavedDraft(detail.dirty);
    };
    window.addEventListener(DRAFT_STATE_EVENT, receiveDraftState);
    return () => window.removeEventListener(DRAFT_STATE_EVENT, receiveDraftState);
  }, [agentId]);
  return <section id="audit" className="scroll-mt-32 rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">设计检查</h2>
        <p className="mt-1 text-xs text-gray-500">已保存流程得分 {score}，发布前必须解决所有阻塞问题。</p>
      </div>
      {fixable ? <button type="button" disabled={pending || hasUnsavedDraft} onClick={async () => {
        setPending(true); setNotice(null); setError(null);
        try {
          const result = await applyAuditFixesAction(agentId);
          if (result.ok) {
            setNotice(result.unchanged
              ? `流程已经处于自动修复后的状态；仍有 ${result.remainingCritical} 个阻塞问题需要人工处理。`
              : `已完成 ${result.applied.length} 项安全修复；仍有 ${result.remainingCritical} 个阻塞问题需要人工处理。`);
            router.refresh();
          } else setError(result.error);
        } catch {
          setError("暂时无法确认安全修复是否完成。请先刷新并核对设计检查，再决定是否重试。");
        } finally {
          setPending(false);
        }
      }} className="rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:border-blue-500 disabled:opacity-50">
        {pending ? "正在修复…" : hasUnsavedDraft ? "保存后再修复" : "应用安全修复"}
      </button> : null}
    </div>
    {hasUnsavedDraft ? <p role="status" className="mt-2 text-sm text-amber-700">下方检查基于已保存流程；本页未保存的修改尚未重新检查。请先保存并刷新，再判断问题是否仍存在。{fixable ? "保存后才能应用安全修复。" : ""}</p> : null}
    {issues.length > 0 ? <ul className="mt-3 space-y-2">
      {visibleIssues.map((issue) => <li key={issue.id} className="rounded-md bg-gray-50 p-2 text-sm">
        <p className={issue.severity === "critical" ? "font-medium text-red-700" : "font-medium text-amber-700"}>{userText(issue.title)}</p>
        <p className="mt-0.5 text-xs text-gray-600">{userText(issue.detail)}</p>
        {issue.nodeId ? <button type="button" onClick={() => requestWorkflowNodeFocus({ agentId, nodeId: issue.nodeId! })}
          className="mt-2 rounded-md px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">在流程中查看</button> : null}
      </li>)}
    </ul> : <p className="mt-3 text-sm text-emerald-700">当前设计检查通过。</p>}
    {issues.length > 8 ? <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-2 text-xs text-blue-700 hover:underline">
      {expanded ? "收起其他问题" : `查看其他 ${issues.length - 8} 项问题`}
    </button> : null}
    {notice ? <p role="status" className="mt-2 text-sm text-blue-700">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </section>;
}
