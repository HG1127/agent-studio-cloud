import Link from "next/link";
import type { RunReportFile, RunStepView } from "@/contracts/run";
import { RunReportFile as RunReportSchema } from "@/contracts/run";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { CONTEXT_PAGE_SIZE, RunContextFilters, contextStepAnchor, runContextHref } from "./run-context-navigation";
import { contextResultPreview } from "./run-context-preview";
import { HarnessNavigation, harnessParams } from "./harness-navigation";

export function RunContextSection({ runId, context, steps, readFailed, filters, navigation = HarnessNavigation.parse({}) }: {
  runId: string;
  context: RunReportFile["context"];
  steps: RunStepView[] | null;
  readFailed: boolean;
  filters: ReturnType<typeof RunContextFilters.safeParse>;
  navigation?: HarnessNavigation;
}) {
  const resetHref = runContextHref(runId, { page: 1, query: "" }, navigation);
  const preserved = harnessParams({ ...navigation, runId, context: { page: 1, query: "" } });
  const outputs = context !== null && Object.hasOwn(context, "outputs")
    ? RunReportSchema.shape.context.unwrap().safeParse(context.outputs) : null;
  const stepNames = new Map(steps?.map((step) => [step.nodeId, step]) ?? []);
  const sources = outputs?.success ? Object.entries(outputs.data).map(([nodeId, value], index) => {
    const step = stepNames.get(nodeId);
    return { nodeId, value, step, title: step ? redactSensitiveText(step.nodeTitle?.trim() || "未命名步骤") : "来源结果 " + (index + 1) };
  }) : [];
  const selected = filters.success ? sources.filter((source) => !filters.data.query || source.title.toLocaleLowerCase("zh-CN").includes(filters.data.query.toLocaleLowerCase("zh-CN"))) : [];
  const page = filters.success ? filters.data.page : 1;
  const offset = (page - 1) * CONTEXT_PAGE_SIZE;
  const visible = selected.slice(offset, offset + CONTEXT_PAGE_SIZE);
  const lastPage = Math.max(1, Math.ceil(selected.length / CONTEXT_PAGE_SIZE));
  const ready = filters.success && !readFailed && outputs?.success;

  return <section id="saved-context" tabIndex={-1} aria-labelledby="saved-context-title" className="content-card min-w-0 scroll-mt-24">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="saved-context-title" className="section-title">已保存的上游结果快照</h2><p className="mt-1 text-sm leading-6 text-slate-500">核对运行已保存的过程内容，不从当前流程草稿或最终交付补造。</p></div><a href={`/api/runs/${runId}/export`} download className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">下载含快照的运行报告</a></div>
    <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-950">这不是各步实际发送的模型请求，也不包含完整来源审计、身份判断或上下文用量。没有独立保存时间；步骤记录与快照分别读取，不保证是同一时刻，也不能证明后续步骤实际使用了全部内容。</p>
    {!filters.success ? <div className="mt-3 space-y-2"><p role="alert" className="text-sm leading-6 text-amber-900">快照筛选条件无效。请清除后重新核对，不自动替换页码或扩大范围。</p><Link href={resetHref} prefetch={false} className="text-xs font-semibold text-indigo-700">清除快照筛选</Link></div> : readFailed ? <p role="alert" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">上游结果快照暂时无法读取，不能判断为空。其他步骤和轨迹仍可核对，可重新读取状态；报告下载会重新读取全部证据，当前不保证可用。</p> : context === null ? <p role="status" className="mt-3 text-sm leading-6 text-slate-500">当前没有可核对的上游结果快照。不表示没有执行产出，请结合步骤记录与轨迹核对。</p> : !outputs ? <p role="status" className="mt-3 text-sm leading-6 text-slate-500">已读到快照，但没有上游结果字段。不能据此判断没有执行产出，可下载报告核对已保存内容。</p> : !outputs.success ? <p role="alert" className="mt-3 text-sm leading-6 text-amber-900">已保存的上游结果格式暂时无法核对，不按空记录显示。其他步骤和轨迹仍可用，可重新读取或下载报告。</p> : <>
      {steps === null ? <p className="mt-3 text-xs leading-5 text-amber-900">步骤清单暂不可读，来源名称和关联入口无法核对；快照内容本身仍可查看。</p> : null}
      <form key={`${runId}:${page}:${filters.data.query}`} action="/harness#saved-context" method="get" className="mt-4 flex flex-wrap items-end gap-2">
        {Array.from(preserved).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        <label className="min-w-0 flex-1"><span className="block text-xs font-medium text-slate-600">按来源步骤名称筛选快照</span><input type="search" name="contextQuery" maxLength={100} defaultValue={filters.data.query} className="mt-1 h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" placeholder="只查来源名称，不查业务内容" /></label>
        <button type="submit" className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">应用快照筛选</button>
        {filters.data.query || page > 1 ? <Link href={resetHref} prefetch={false} className="inline-flex h-10 items-center rounded-lg px-2 text-xs font-semibold text-indigo-700">清除快照筛选</Link> : null}
      </form>
      <p className="mt-2 text-xs leading-5 text-slate-500">当前快照共有 {sources.length} 项来源结果，筛选后 {selected.length} 项；本页显示 {visible.length} 项，每页最多十项。排列与编号不代表执行顺序，条目数不是完整模型上下文数量。</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">预览已脱敏，每项限制内容长度、层级与条目。完整脱敏快照通过报告核对，不在页面复制截取内容冒充原始证据。</p>
      {visible.length ? <ol aria-label="快照来源结果" className="mt-4 space-y-3">{visible.map((source) => {
        const preview = contextResultPreview(source.value, source.step?.nodeType);
        return <li key={source.nodeId} data-context-node={source.nodeId} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words text-sm font-semibold text-slate-900">{source.title}</h3>{source.step ? <a href={"#" + contextStepAnchor(source.step.id)} className="text-xs font-semibold text-indigo-700 hover:text-indigo-900">定位到关联步骤</a> : <p className="text-xs text-slate-500">未关联到当前可读的步骤名称，不猜测来源。</p>}</div>
          <details aria-label={source.title + "的快照内容"} className="mt-2 min-w-0"><summary className="cursor-pointer text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">查看此项快照内容</summary>
            {!preview.readable ? <p role="alert" className="mt-3 text-sm leading-6 text-amber-900">此项内容暂时无法显示，不替换为空对象。可通过报告核对，导出是否可用以实际响应为准。</p> : <><div role="group" aria-label="上游结果内容预览" className="mt-3 max-h-64 min-w-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">{preview.emptyLabel ? <p className="text-sm text-slate-600">{preview.emptyLabel}</p> : <StructuredRunValue value={preview.value} />}</div>{preview.shortened ? <p className="mt-2 text-xs leading-5 text-amber-900">此项预览已缩短或省略，不代表原始内容为空。请下载完整报告核对。</p> : null}<p className="mt-2 text-xs leading-5 text-slate-500">常见敏感信息与内部关联字段已隐藏，深层内容可能省略；不是完整数据安全审查，也不是最终交付。</p></>}
          </details>
        </li>;
      })}</ol> : <p role="status" className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-500">{page > lastPage ? "这个快照页没有来源结果，不表示整个范围为空。请返回最后一页继续核对。" : filters.data.query ? "当前快照没有匹配来源名称的结果。筛选不查业务内容，不表示没有执行产出。" : "快照已保存空的上游结果清单。不表示没有步骤记录或最终交付。"}</p>}
    </>}
    {ready && (page > 1 || page < lastPage) ? <nav aria-label="快照来源分页" className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3 text-xs"><span className="text-slate-500">第 {page} 页</span>{page > lastPage ? <Link href={runContextHref(runId, { ...filters.data, page: lastPage }, navigation)} prefetch={false} className="font-semibold text-indigo-700">返回最后一页</Link> : <>{page > 1 ? <Link href={runContextHref(runId, { ...filters.data, page: page - 1 }, navigation)} prefetch={false} className="font-semibold text-indigo-700">上一页</Link> : null}{page < lastPage ? <Link href={runContextHref(runId, { ...filters.data, page: page + 1 }, navigation)} prefetch={false} className="font-semibold text-indigo-700">下一页</Link> : null}</>}</nav> : null}
  </section>;
}
