import type { RunReportFile, RunStepView, TraceEventView } from "@/contracts/run";

export function RunEvidenceOverview({ steps, trace, context, contextReadFailed, contextFiltersValid }: {
  steps: RunStepView[] | null;
  trace: TraceEventView[] | null;
  context: RunReportFile["context"];
  contextReadFailed: boolean;
  contextFiltersValid: boolean;
}) {
  const items = [
    { title: "步骤记录", anchor: "diagnostic-steps", unavailable: steps === null,
      status: steps === null ? "读取失败，数量未知" : `已读取 ${steps.length} 条步骤记录`,
      hint: "记录可能含同一步骤的多次尝试，不代表计划步骤总数。", label: "定位步骤证据" },
    { title: "最近轨迹", anchor: "diagnostic-trace", unavailable: trace === null,
      status: trace === null ? "读取失败，数量未知" : `已读取 ${trace.length} 条最近事件`,
      hint: "只覆盖最近已保存的事件，不代表完整历史或安全规则判决。", label: "定位轨迹证据" },
    { title: "上游结果快照", anchor: "saved-context", unavailable: !contextFiltersValid || contextReadFailed,
      status: !contextFiltersValid ? "筛选无效，本次未读取" : contextReadFailed ? "读取失败，内容未知" : context === null ? "当前没有可核对的快照" : "已读取快照，需核对来源内容",
      hint: "保存的过程内容不能证明后续步骤实际使用了全部结果。", label: "定位快照证据" },
  ];

  return <section aria-labelledby="harness-evidence-title" className="content-card min-w-0">
    <h2 id="harness-evidence-title" className="section-title">本次证据读取</h2>
    <p className="mt-1 text-sm leading-6 text-slate-500">下面是所选任务本次读取的范围。各项分别读取，不能据此判断任务已通过验收；筛选不会改变已读取总数。</p>
    <div className="mt-4 grid gap-3 lg:grid-cols-3">{items.map((item) => <a key={item.anchor} href={`#${item.anchor}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">
      <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
      <p className={`mt-2 text-sm font-medium ${item.unavailable ? "text-amber-900" : "text-slate-800"}`}>{item.status}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{item.hint}</p>
      <span className="mt-3 block text-xs font-semibold text-indigo-700">{item.label} →</span>
    </a>)}</div>
    <a href="#diagnostic-next-step" className="mt-4 inline-block rounded-lg px-1 py-2 text-sm font-semibold text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">核对本次任务的下一步 →</a>
  </section>;
}
