import type { RunStepView, RunView } from "@/contracts/run";
import { BusinessResultExportButtons } from "./BusinessResultExportButtons";
import { savedBusinessResultExport } from "./saved-business-result-export";

export function SavedBusinessResultExport({ run, steps = [], stepsUnavailable = false }: {
  run: Pick<RunView, "id" | "agentId" | "versionId" | "parentRunId" | "status" | "sourceType" | "result" | "outputContract">;
  steps?: readonly RunStepView[];
  stepsUnavailable?: boolean;
}) {
  const result = savedBusinessResultExport(run, steps, stepsUnavailable);
  return <section aria-label="已保存业务成果导出" className="space-y-3 border-t border-slate-200 pt-4">
    <h3 className="text-sm font-semibold text-slate-900">导出已保存的业务展示内容</h3>
    {!result.available ? <p role="status" className="text-sm leading-6 text-amber-900">{result.message}</p> : <>
      <p className="text-xs leading-5 text-slate-600">{result.stateText}</p>
      <p className="text-xs leading-5 text-slate-500">{result.scopeText}</p>
      <p className="text-xs leading-5 text-slate-500">清单只按记录状态、交付内容、已保存内容三列整理；数组和对象保留为展示文字，不转换成有业务含义的数据表。</p>
      <BusinessResultExportButtons key={run.id} markdown={result.markdown} csv={result.csv} />
    </>}
  </section>;
}
