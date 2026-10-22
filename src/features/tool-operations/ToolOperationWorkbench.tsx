"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ToolOperationListInput, type ToolOperationListResult, type ToolOperationView } from "@/contracts/tool-operation";
import { readToolOperation, readToolOperations } from "./tool-operation-client";
import { operationDate, operationStatusLabels, operationText } from "./tool-operation-presentation";
import { ToolOperationDetails } from "./ToolOperationDetails";
import { ToolOperationReconciliationForm } from "./ToolOperationReconciliationForm";
import { ToolOperationLeaveGuard } from "./ToolOperationLeaveGuard";
import { toolOperationRunHref } from "./tool-operation-navigation";

type Directory = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; result: Extract<ToolOperationListResult, { ok: true }> };
type Detail = { kind: "empty" } | { kind: "loading"; id: string } | { kind: "failed"; id: string; message: string } | { kind: "ready"; operation: ToolOperationView };

export function ToolOperationWorkbench({ initialFilters }: { initialFilters: ToolOperationListInput }) {
  const [pages, setPages] = useState<ToolOperationListInput[]>([initialFilters]);
  const filters = pages.at(-1)!;
  const [directory, setDirectory] = useState<Directory>({ kind: "loading" });
  const [detail, setDetail] = useState<Detail>({ kind: "empty" });
  const [revision, setRevision] = useState(0);
  const [locked, setLocked] = useState(false);
  const [directorySlow, setDirectorySlow] = useState(false);
  const [detailSlow, setDetailSlow] = useState(false);
  const lockedRef = useRef(false);
  const activeDetail = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => { if (!controller.signal.aborted) setDirectorySlow(true); }, 10_000);
    void readToolOperations(filters, controller.signal).then((result) => {
      if (!controller.signal.aborted) setDirectory(result.ok ? { kind: "ready", result } : { kind: "failed", message: operationText(result.error) });
    }).catch(() => { if (!controller.signal.aborted) setDirectory({ kind: "failed", message: "核对列表暂时无法读取，当前不能判断是否有记录。" }); }).finally(() => window.clearTimeout(timer));
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [filters, revision]);
  useEffect(() => () => activeDetail.current?.abort(), []);

  function lock(value: boolean) { lockedRef.current = value; setLocked(value); }
  function changePages(next: ToolOperationListInput[]) {
    if (lockedRef.current) return;
    activeDetail.current?.abort(); setDetail({ kind: "empty" }); setDirectory({ kind: "loading" }); setDirectorySlow(false); setPages(next);
  }
  function refresh() {
    if (lockedRef.current) return;
    activeDetail.current?.abort(); setDetail({ kind: "empty" }); setDirectory({ kind: "loading" }); setDirectorySlow(false); setRevision((value) => value + 1);
  }
  async function select(id: string) {
    if (lockedRef.current) return;
    const selected = directory.kind === "ready" ? directory.result.items.find((item) => item.id === id) : null;
    if (!selected) return;
    activeDetail.current?.abort();
    const controller = new AbortController(); activeDetail.current = controller;
    setDetailSlow(false);
    const timer = window.setTimeout(() => { if (!controller.signal.aborted) setDetailSlow(true); }, 10_000);
    setDetail({ kind: "loading", id });
    try {
      const result = await readToolOperation(id, controller.signal);
      if (!controller.signal.aborted) {
        const matchingSource = result.ok && result.operation.sourceRunId.toLowerCase() === selected.sourceRunId.toLowerCase()
          && (!filters.sourceRunId || result.operation.sourceRunId.toLowerCase() === filters.sourceRunId.toLowerCase());
        setDetail(result.ok && matchingSource ? { kind: "ready", operation: result.operation } : { kind: "failed", id, message: result.ok ? "详情与所选任务不一致，未开放核对表单。请重新读取详情或列表。" : operationText(result.error) });
      }
    } catch {
      if (!controller.signal.aborted) setDetail({ kind: "failed", id, message: "核对详情暂时无法读取，请重新读取。本次没有提交核对结论。" });
    } finally {
      window.clearTimeout(timer);
    }
  }

  return <div className="space-y-4">
    <ToolOperationLeaveGuard locked={locked} />
    <section aria-label="核对记录筛选" className="content-card flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <label className="text-sm font-semibold text-slate-700">记录状态
        <select className="mt-2 block w-full min-w-48 rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:opacity-50" value={filters.status ?? ""} disabled={locked} onChange={(event) => {
          const base = { limit: filters.limit, sourceRunId: filters.sourceRunId };
          changePages([ToolOperationListInput.parse({ ...base, ...(event.target.value ? { status: event.target.value } : {}) })]);
        }}>
          <option value="">全部状态</option><option value="blocked">结果待人工核对</option><option value="pending">尚未确认完成</option><option value="completed">已确认完成</option>
        </select>
      </label>
      {filters.sourceRunId ? <div className="space-y-1 text-xs text-slate-500"><p>仅查看指定任务的业务记录。</p><Link href={toolOperationRunHref(filters.sourceRunId, filters)} className="font-semibold text-indigo-700 hover:underline">查看源任务</Link></div> : <p className="max-w-sm text-xs leading-5 text-slate-500">查看当前工作区的业务工具记录，不受运行中心的助手或发起方式筛选影响。</p>}
      <Button type="button" variant="secondary" disabled={locked || (directory.kind === "loading" && !directorySlow)} onClick={refresh}>重新读取列表</Button>
    </section>
    {locked ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">正在确认或核对本次提交。请先处理当前请求，再切换记录或筛选。</p> : null}
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
      <section aria-label="业务核对记录列表" className="content-card min-w-0">
        <h2 className="section-title">业务核对记录</h2>
        {directory.kind === "loading" ? <p role="status" className="mt-4 text-sm text-slate-500">正在读取业务核对记录…</p> : null}
        {directory.kind === "loading" && directorySlow ? <p className="mt-2 text-sm text-amber-900">读取时间较长，可以重新读取列表。尚未读到记录不代表没有记录。</p> : null}
        {directory.kind === "failed" ? <p role="alert" className="mt-4 text-sm text-amber-900">{directory.message}</p> : null}
        {directory.kind === "ready" ? <>
          {directory.result.items.length === 0 ? <div role="status" className="mt-4 rounded-xl bg-slate-50 p-4"><p className="font-semibold text-slate-700">当前分页与筛选下没有记录</p><p className="mt-2 text-sm text-slate-500">可调整状态或返回首批记录；本页未发现记录不能说明业务系统未执行操作。</p></div> : <ul className="mt-4 space-y-3">
            {directory.result.items.map((item) => <li key={item.id} className="rounded-xl border border-slate-200 p-3">
              <h3 className="break-words font-semibold text-slate-900">{operationText(item.nodeTitle, item) || "业务步骤"}</h3>
              <p className="mt-1 text-xs text-indigo-700">{operationStatusLabels[item.status]}</p>
              <p className="mt-2 text-xs text-slate-500">首次记录：{operationDate(item.createdAt)} · 已核对{item.resolutionCount}次</p>
              <Button type="button" size="sm" variant="secondary" className="mt-3" disabled={locked} onClick={() => void select(item.id)} aria-label={`查看${operationText(item.nodeTitle, item) || "业务步骤"}的核对记录`}>查看核对记录</Button>
            </li>)}
          </ul>}
          <nav aria-label="核对记录分页" className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <Button type="button" variant="secondary" size="sm" disabled={locked || pages.length === 1} onClick={() => changePages(pages.slice(0, -1))}>上一批记录</Button>
            <Button type="button" variant="secondary" size="sm" disabled={locked || !directory.result.nextCursor} onClick={() => {
              const cursor = directory.result.nextCursor;
              if (cursor) changePages([...pages, { ...filters, before: cursor.createdAt, beforeId: cursor.id }]);
            }}>下一批记录</Button>
            {filters.before ? <Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => changePages([{ limit: filters.limit, status: filters.status, sourceRunId: filters.sourceRunId }])}>返回首批记录</Button> : null}
            <span className="text-xs text-slate-500">本页{directory.result.items.length}条</span>
          </nav>
        </> : null}
      </section>
      <section aria-label="当前业务核对" className="content-card min-w-0">
        {detail.kind === "empty" ? <p className="py-8 text-center text-sm text-slate-500">选择一条记录，查看回执与核对历史。</p> : null}
        {detail.kind === "loading" ? <p role="status" className="text-sm text-slate-500">正在读取核对详情…</p> : null}
        {detail.kind === "loading" && detailSlow ? <div className="mt-3 space-y-2"><p className="text-sm text-amber-900">详情读取时间较长，可以重新读取。本次没有提交核对结论。</p><Button type="button" variant="secondary" onClick={() => void select(detail.id)}>重新读取详情</Button></div> : null}
        {detail.kind === "failed" ? <div className="space-y-3"><p role="alert" className="text-sm text-amber-900">{detail.message}</p><Button type="button" variant="secondary" onClick={() => void select(detail.id)}>重新读取详情</Button></div> : null}
        {detail.kind === "ready" ? <>
          <Link href={toolOperationRunHref(detail.operation.sourceRunId, filters)} className="mb-4 inline-flex text-sm font-semibold text-indigo-700 hover:underline">查看这条记录的源任务</Link>
          <ToolOperationDetails operation={detail.operation} />
          <ToolOperationReconciliationForm key={detail.operation.id} operation={detail.operation} onLockChange={lock} onObserved={(operation) => {
            setDetail((current) => current.kind === "ready" && current.operation.id === operation.id && current.operation.sourceRunId.toLowerCase() === operation.sourceRunId.toLowerCase() ? { kind: "ready", operation } : current);
          }} />
        </> : null}
      </section>
    </div>
  </div>;
}
