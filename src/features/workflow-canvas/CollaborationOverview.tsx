"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CircleAlert, ExternalLink, Network, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentTargetOption } from "@/contracts/agent";
import type { WorkflowDraft } from "@/contracts/workflow";
import { workflowCollaborations } from "./workflow-collaborations";

const PAGE_SIZE = 10;
function FieldSummary({ label, fields }: { label: string; fields: string[] | null }) {
  return <div className="min-w-0"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm leading-6 text-slate-800">{fields === null ? "约定暂不可读" : fields.length === 0 ? "没有记录字段" : fields.join("、")}</dd></div>;
}

export function CollaborationOverview({ draft, agentId, targets, dirty, disabled, onFocusNode, onAdd }: {
  draft: WorkflowDraft;
  agentId: string;
  targets: readonly AgentTargetOption[];
  dirty: boolean;
  disabled: boolean;
  onFocusNode: (nodeId: string) => void;
  onAdd: (kind: "agent_call" | "handoff") => void;
}) {
  const rows = useMemo(() => workflowCollaborations(draft, targets, agentId), [draft, targets, agentId]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [attention, setAttention] = useState(false);
  const [page, setPage] = useState(1);
  const filtered = rows.filter((row) => (kind === "all" || row.kind === kind) && (!attention || row.issues.length > 0) && (!query.trim() || `${row.title} ${row.location} ${row.targetName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const hasFilters = Boolean(query || kind !== "all" || attention);
  function clearFilters() { setQuery(""); setKind("all"); setAttention(false); setPage(1); }

  return <section aria-label="助手协作清单" className="content-card min-w-0 space-y-4 p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><Network className="size-5" /></span><div className="min-w-0"><h2 className="text-lg font-bold text-slate-900">助手协作</h2><p className="mt-1 text-sm leading-6 text-slate-500">按当前流程草稿核对呼叫、交接和固定版本，包含并行工作与步骤组。这不是正式团队成员或权限清单。</p></div></div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${dirty ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>{dirty ? "包含未保存修改" : "当前已保存草稿"}</span>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-sm text-slate-700">共 {rows.length} 项协作步骤 · 呼叫 {rows.filter((row) => row.kind === "agent_call").length} 项 · 交接 {rows.filter((row) => row.kind === "handoff").length} 项 · {rows.filter((row) => row.issues.length > 0).length} 项需核对</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onAdd("agent_call")}>添加独立呼叫步骤</Button><Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => onAdd("handoff")}>添加独立交接步骤</Button></div>
    </div>
    {rows.length > 0 ? <div className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-medium text-slate-600">搜索协作步骤<div className="relative"><Search className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input aria-label="搜索协作步骤" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="步骤、接收助手或所属工作" className="h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900" /></div></label>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-slate-600">协作类型<select aria-label="协作类型" value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"><option value="all">全部协作</option><option value="agent_call">呼叫助手</option><option value="handoff">交接任务</option></select></label>
      <label className="flex min-h-10 items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={attention} onChange={(event) => { setAttention(event.target.checked); setPage(1); }} />只看需要核对</label>
      {hasFilters ? <Button type="button" size="sm" variant="ghost" onClick={clearFilters}>清除协作筛选</Button> : null}
    </div> : null}
    {filtered.length === 0 ? <div role="status" className="rounded-xl border border-dashed border-slate-300 p-5 text-center"><p className="text-sm font-semibold text-slate-700">{rows.length === 0 ? "当前草稿还没有助手协作步骤" : "没有符合筛选条件的协作步骤"}</p><p className="mt-1 text-xs leading-5 text-slate-500">{rows.length === 0 ? "可添加呼叫或交接步骤，选择已发布助手并连接流程。添加只改草稿，不会启动对方任务。" : "筛选仅作用于当前草稿，不代表协作步骤已删除。"}</p></div> : <ul aria-label="协作步骤" className="space-y-3">
      {filtered.slice(offset, offset + PAGE_SIZE).map((row) => <li key={row.key} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words text-xs text-slate-500">{row.location} · {row.kind === "agent_call" ? "呼叫助手" : "交接任务"}</p><h3 className="mt-1 break-words text-base font-semibold text-slate-900">{row.title}</h3><p className="mt-2 flex flex-wrap items-center gap-2 break-words text-sm text-slate-700"><span>{draft.rootAgent.name || "当前流程"}</span><ArrowRight aria-hidden className="size-3.5 shrink-0 text-slate-400" /><span className="font-semibold text-indigo-800">{row.targetName}</span></p></div><Button type="button" variant="secondary" size="sm" onClick={() => onFocusNode(row.ownerNodeId)} aria-label={`编辑协作：${row.location} · ${row.title}`}>回到步骤编辑</Button></div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-md bg-indigo-50 px-2 py-1 text-indigo-800">{row.versionLabel}</span><span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{row.memoryLabel}</span>{row.targetHref ? <Link href={row.targetHref} className="inline-flex items-center gap-1 font-medium text-indigo-700 hover:underline">打开接收助手工作台<ExternalLink className="size-3" /></Link> : null}</div>
        {row.issues.length > 0 ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900"><CircleAlert className="size-3.5" />需要核对</p><ul className="mt-1 space-y-1 text-xs leading-5 text-amber-900">{row.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
        <details className="mt-3 border-t border-slate-100 pt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-600">查看输入和返回约定</summary><dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"><FieldSummary label="传入内容" fields={row.inputLabels} /><FieldSummary label="返回内容" fields={row.outputLabels} />{row.kind === "handoff" ? <><FieldSummary label="必须交付" fields={row.node?.contract?.deliverables ?? null} /><FieldSummary label="禁止传递" fields={row.node?.contract?.mustNotInclude ?? null} /></> : null}</dl><p className="mt-3 text-xs leading-5 text-slate-500">这里核对步骤记录的约定，不代表输入映射、目标助手授权或执行已验证。经验选项只控制上游经验步骤结果，不控制目标助手自身经验。</p></details>
      </li>)}
    </ul>}
    {filtered.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><p role="status" className="text-xs text-slate-500">显示第 {offset + 1}–{Math.min(offset + PAGE_SIZE, filtered.length)} 项，共 {filtered.length} 项</p>{pageCount > 1 ? <nav aria-label="协作清单翻页" className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页协作</Button><span className="text-xs text-slate-500">第 {currentPage} / {pageCount} 页</span><Button type="button" variant="ghost" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页协作</Button></nav> : null}</div> : null}
    <p className="text-xs leading-5 text-slate-500">呼叫与交接都使用已固定版本运行对方流程；是否执行仍取决于真实路径与发布检查。这里不替代完整设计检查。修改后需保存草稿并重新发布，不改变当前正式版本。</p>
  </section>;
}
