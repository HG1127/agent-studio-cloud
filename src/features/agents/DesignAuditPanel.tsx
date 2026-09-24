"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AuditIssueView } from "@/contracts/audit";
import { applyAuditFixesAction } from "@/server/actions/apply-audit-fixes";

function userText(value: string): string {
  return value.replaceAll("Agent", "助手").replaceAll("Workflow", "流程").replaceAll("Schema", "字段结构").replaceAll("Checkpoint", "恢复点");
}

export function DesignAuditPanel({ agentId, score, issues }: { agentId: string; score: number; issues: AuditIssueView[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fixable = issues.some((issue) => issue.fixable);
  return <section className="rounded-lg border border-gray-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">设计检查</h2>
        <p className="mt-1 text-xs text-gray-500">当前得分 {score}，发布前必须解决所有阻塞问题。</p>
      </div>
      {fixable ? <button type="button" disabled={pending} onClick={async () => {
        setPending(true); setNotice(null); setError(null);
        try {
          const result = await applyAuditFixesAction(agentId);
          if (result.ok) {
            setNotice(`已完成 ${result.applied.length} 项安全修复；仍有 ${result.remainingCritical} 个阻塞问题需要人工处理。`);
            router.refresh();
          } else setError(result.error);
        } catch {
          setError("自动修复失败，请稍后重试");
        } finally {
          setPending(false);
        }
      }} className="rounded-md border border-blue-300 px-3 py-1.5 text-sm text-blue-700 hover:border-blue-500 disabled:opacity-50">
        {pending ? "正在修复…" : "应用安全修复"}
      </button> : null}
    </div>
    {issues.length > 0 ? <ul className="mt-3 space-y-2">
      {issues.slice(0, 8).map((issue) => <li key={issue.id} className="rounded-md bg-gray-50 p-2 text-sm">
        <p className={issue.severity === "critical" ? "font-medium text-red-700" : "font-medium text-amber-700"}>{userText(issue.title)}</p>
        <p className="mt-0.5 text-xs text-gray-600">{userText(issue.detail)}</p>
      </li>)}
    </ul> : <p className="mt-3 text-sm text-emerald-700">当前设计检查通过。</p>}
    {issues.length > 8 ? <p className="mt-2 text-xs text-gray-500">另有 {issues.length - 8} 项问题未展开。</p> : null}
    {notice ? <p role="status" className="mt-2 text-sm text-blue-700">{notice}</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </section>;
}
