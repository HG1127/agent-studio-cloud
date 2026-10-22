import type { AgentInputField } from "@/contracts/manifest";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import { evaluationInputRows } from "./evaluation-input-fields";

export function EvaluationInputPreview({ input, fields }: { input: Record<string, unknown>; fields?: AgentInputField[] }) {
  const { matchesCurrentVersion, entries } = evaluationInputRows(input, fields);
  return <div className="mt-2 space-y-2">
    {entries.length === 0 ? <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">这条样例没有填写运行输入。</p> : <>
      {!matchesCurrentVersion && fields?.length ? <p className="text-xs leading-5 text-amber-700">这条样例的输入与当前版本字段不同。下方按顺序展示已保存的内容；编辑时仍会保留原始字段。</p> : null}
      <dl className="space-y-2">
        {entries.map(({ label, value }, index) => <div key={index} className="min-w-0 rounded-lg bg-slate-50 p-3">
          <dt className="mb-1 text-xs font-semibold text-slate-600">{label}</dt>
          <dd className="min-w-0"><StructuredRunValue value={value} /></dd>
        </div>)}
      </dl>
    </>}
  </div>;
}
