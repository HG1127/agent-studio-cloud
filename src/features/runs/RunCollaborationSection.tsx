import Link from "next/link";
import { ArrowRight, GitBranch, Search, SearchX } from "lucide-react";
import { RunStatus } from "@/contracts/run";
import type { RunSummary } from "@/contracts/run";
import { RunSectionUnavailable } from "./RunSectionUnavailable";
import { RUN_STATUS_LABEL, RunStatusBadge } from "./RunList";
import { childRunHref, collaborationHref, collaborationParams } from "./run-collaboration-navigation";
import type { CollaborationListState, CollaborationParent } from "./run-collaboration-navigation";
import { collaborationDate, collaborationDuration, collaborationView } from "./run-collaboration-view";

const sourceLabels: Record<RunSummary["sourceType"], string> = {
  agent_call: "助手协作", handoff: "助手交接", manual: "手动运行", schedule: "定时任务", evaluation: "自动验收",
};
const fieldClass = "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
const linkClass = "inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

export function RunCollaborationSection({ runId, runs, backHref, state, invalidState = false, parent = null }: {
  runId: string;
  runs: RunSummary[] | null;
  backHref: string;
  state: CollaborationListState;
  invalidState?: boolean;
  parent?: CollaborationParent | null;
}) {
  const view = runs === null ? null : collaborationView(runs, state);
  const hiddenParams = collaborationParams(backHref, { ...state, query: "", sourceType: undefined, status: undefined, page: 1 }, parent);
  return <section id="collaboration" aria-labelledby="collaboration-title" className="content-card scroll-mt-32 space-y-4">
    <header className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><GitBranch aria-hidden className="size-5" /></span>
      <div><p className="eyebrow">本次任务的协作记录</p><h2 id="collaboration-title" className="mt-1 text-base font-bold text-slate-950">协作子任务</h2><p className="mt-1 text-sm leading-6 text-slate-500">核对直接关联的子任务，进入详情查看真实输入、结果和需要处理的事项。</p></div>
    </header>
    {runs === null || view === null ? <RunSectionUnavailable title="协作子任务暂时无法读取" message="不能判断是否有其他助手参与，也不能将暂不可读计为零。已读到的当前任务内容仍可核对。" /> : <>
      <p className="text-xs leading-5 text-slate-500">以下数量、搜索和筛选仅针对本次读取的直接子任务，不包含下级任务或正式团队成员。子任务完成不等于上级任务已完成；需要最新状态时，请使用页面上方的“重新读取状态”。时间均为北京时间。</p>
      {invalidState ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">协作筛选条件无法读取，已显示本次读取记录的第一页，请重新选择条件。</p> : null}
      <dl aria-label="本次读取的协作数量" className="grid grid-cols-5 gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
        {[
          ["已读取", view.summary.total], ["排队或执行", view.summary.active], ["等待或失败", view.summary.attention],
          ["已完成", view.summary.completed], ["已取消", view.summary.cancelled],
        ].map(([label, count]) => <div key={label} className="min-w-0 px-2"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 text-xl font-bold tabular-nums text-slate-900">{count}</dd></div>)}
      </dl>
      {runs.length > 0 || view.filtered || state.page > 1 ? <form key={JSON.stringify(state)} action={`/runs/${runId}#collaboration`} method="get" aria-label="筛选协作子任务" className="grid grid-cols-[minmax(0,1fr)_9rem_9rem] items-end gap-3">
        {Array.from(hiddenParams, ([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="text-xs font-semibold text-slate-600">搜索协作助手<input type="search" name="colQuery" maxLength={100} defaultValue={state.query} placeholder="按助手名称查找" className={fieldClass} /></label>
        <label className="text-xs font-semibold text-slate-600">协作方式<select name="colType" defaultValue={state.sourceType ?? ""} className={fieldClass}><option value="">全部方式</option><option value="agent_call">助手协作</option><option value="handoff">助手交接</option></select></label>
        <label className="text-xs font-semibold text-slate-600">子任务状态<select name="colStatus" defaultValue={state.status ?? ""} className={fieldClass}><option value="">全部状态</option>{RunStatus.options.map((status) => <option key={status} value={status}>{RUN_STATUS_LABEL[status]}</option>)}</select></label>
        <div className="col-span-3 flex flex-wrap justify-end gap-2"><button type="submit" className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"><Search aria-hidden className="size-4" />应用协作筛选</button>{view.filtered ? <Link className={`${linkClass} h-10`} href={collaborationHref(runId, backHref, { query: "", page: 1 }, parent)}>清除协作筛选</Link> : null}</div>
      </form> : null}
      {view.rows.length > 0 ? <>
        <p role="status" className="text-xs text-slate-500">显示第 {view.start + 1}–{view.start + view.rows.length} 项，共 {view.total} 项匹配记录</p>
        <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full table-fixed text-left text-sm"><caption className="sr-only">已保存的直接协作子任务</caption><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-[30%] px-4 py-3 font-semibold">协作助手与版本</th><th className="w-[14%] px-3 py-3 font-semibold">方式</th><th className="w-[14%] px-3 py-3 font-semibold">状态</th><th className="px-3 py-3 font-semibold">已保存时间</th><th className="w-24 px-3 py-3 font-semibold"><span className="sr-only">查看任务</span></th></tr></thead><tbody className="divide-y divide-slate-100">
          {view.rows.map((child) => <tr key={child.id} className="align-top hover:bg-indigo-50/30"><td className="break-words px-4 py-4"><p className="font-semibold text-slate-900">{child.agentName}</p><p className="mt-1 text-xs text-slate-500">{child.version == null ? "运行版本信息不可用" : `固定运行版本：版本 ${child.version}`}</p>{child.agentArchived ? <p className="mt-1 text-xs text-amber-800">助手已停用，历史任务仍可查看</p> : null}</td><td className="px-3 py-4 text-xs leading-6 text-slate-600">{sourceLabels[child.sourceType]}</td><td className="px-3 py-4"><RunStatusBadge status={child.status} /></td><td className="px-3 py-4 text-xs leading-6 text-slate-500"><p>{child.startedAt ? `开始：${collaborationDate(child.startedAt)}` : "尚未保存开始时间"}</p><p>{child.finishedAt ? `结束：${collaborationDate(child.finishedAt)}` : "尚未保存结束时间"}</p>{collaborationDuration(child) ? <p>耗时：{collaborationDuration(child)}</p> : null}</td><td className="px-3 py-4"><Link href={childRunHref(child.id, runId, backHref, state)} aria-label={`查看子任务：${child.agentName}`} className="inline-flex items-center gap-1 rounded text-xs font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">查看详情<ArrowRight aria-hidden className="size-3" /></Link></td></tr>)}
        </tbody></table></div>
      </> : <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center"><SearchX aria-hidden className="mx-auto size-6 text-slate-400" /><h3 className="mt-2 text-sm font-semibold text-slate-900">{state.page > 1 ? "当前页没有协作子任务" : view.filtered ? "没有符合条件的协作子任务" : "本次尚未读到协作子任务"}</h3><p className="mt-1 text-sm text-slate-500">{state.page > 1 ? "记录可能已有变化，可保留筛选回到第一页继续核对。" : view.filtered ? "调整助手名称、协作方式或状态；筛选不改变任务记录。" : "当前没有已读到的直接协作记录，不代表后续不会产生子任务。"}</p>{state.page > 1 ? <Link className={`${linkClass} mt-3`} href={collaborationHref(runId, backHref, { ...state, page: 1 }, parent)}>回到协作第一页</Link> : null}</div>}
      {state.page > 1 || view.hasNext ? <nav aria-label="协作子任务翻页" className="flex items-center justify-between gap-3"><span>{state.page > 1 ? <Link className={linkClass} href={collaborationHref(runId, backHref, { ...state, page: state.page - 1 }, parent)}>上一页</Link> : null}</span><span className="text-xs text-slate-500">第 {state.page} 页 · 每页最多 10 项</span><span>{view.hasNext ? <Link className={linkClass} href={collaborationHref(runId, backHref, { ...state, page: state.page + 1 }, parent)}>下一页</Link> : null}</span></nav> : null}
    </>}
  </section>;
}
