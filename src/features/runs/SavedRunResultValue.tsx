import type { RunStepView, RunView } from "@/contracts/run";
import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { StructuredRunValue } from "./StructuredRunValue";

function conditionRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(record, "matched") || !Object.prototype.hasOwnProperty.call(record, "next")) return null;
  if (typeof record.matched !== "string" || (record.next !== null && typeof record.next !== "string")) return null;
  return { matched: record.matched, next: record.next };
}

export function SavedRunResultValue({ run, fieldKey, value, steps = [] }: {
  run: Pick<RunView, "id" | "outputContract">;
  fieldKey: string;
  value: unknown;
  steps?: readonly RunStepView[];
}) {
  const definition = run.outputContract.fields.find((field) => field.path === fieldKey);
  if (definition?.sourcePath?.length) return <StructuredRunValue value={value} />;
  const sourceId = definition ? definition.sourceNodeId : fieldKey;
  const source = sourceId ? steps.find((step) => step.runId === run.id && step.nodeId === sourceId) : undefined;
  if (!source || source.nodeType !== "condition") return <StructuredRunValue value={value} />;
  const recorded = conditionRecord(source.output);
  const delivered = recorded ? conditionRecord(value) : null;
  if (!recorded || !delivered) return <StructuredRunValue value={value} />;
  let safeRecord: ReturnType<typeof conditionRecord>;
  try { safeRecord = conditionRecord(redactSensitiveData(source.output)); } catch { return <StructuredRunValue value={value} />; }
  if (!safeRecord || safeRecord.next !== delivered.next || safeRecord.matched !== delivered.matched) return <StructuredRunValue value={value} />;
  const target = recorded.next === null ? undefined : steps.find((step) => step.runId === run.id && step.nodeId === recorded.next);
  const targetTitle = target?.nodeTitle?.trim();
  const verifiedTitle = target && targetTitle && targetTitle !== target.nodeId ? redactSensitiveText(targetTitle) : null;
  const remaining = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => key !== "matched" && key !== "next"));
  return <div role="group" aria-label="条件结果核对" className="min-w-0 space-y-3">
    <dl className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/70 px-3">
      <div className="grid min-w-0 gap-1 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3"><dt className="text-xs font-semibold text-slate-500">命中的分支</dt><dd className="min-w-0 text-sm leading-6 text-slate-700">{delivered.matched || "未保存分支名称"}</dd></div>
      <div className="grid min-w-0 gap-1 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3"><dt className="text-xs font-semibold text-slate-500">记录的去向</dt><dd className="min-w-0 text-sm leading-6 text-slate-700">{recorded.next === null ? "条件记录没有指定后续步骤。" : verifiedTitle || "后续步骤名称尚未读到，可在执行证据中核对。"}</dd></div>
    </dl>
    <p className="text-xs leading-5 text-slate-500">只核对本次保存的判断和去向，不代表后续步骤已完成或业务验收通过。内部关联保留在下方开发者数据及下载报告中。</p>
    {Object.keys(remaining).length ? <StructuredRunValue value={remaining} /> : null}
  </div>;
}
