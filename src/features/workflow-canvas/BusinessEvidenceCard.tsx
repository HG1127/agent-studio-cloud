import { CircleAlert, ShieldCheck } from "lucide-react";
import type { WorkflowNode } from "@/contracts/workflow";
import { recordedBusinessObjective } from "./business-evidence";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rows(value: unknown, keys: string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const direct = text(item);
    if (direct) return [direct];
    const fields = record(item);
    if (!fields) return [];
    const label = keys.map((key) => text(fields[key])).find(Boolean);
    return label ? [label] : [];
  });
}

function statusLabel(value: unknown, labels: Record<string, string>, fallback: string): string {
  const key = text(value);
  return key ? labels[key] ?? fallback : fallback;
}

function EvidenceRow({ label, values, missing, optional = false }: { label: string; values: string[]; missing: string; optional?: boolean }) {
  return <div className="grid gap-1 border-t border-slate-100 pt-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
    <dt className="font-medium text-slate-500">{label}</dt>
    <dd className={`min-w-0 break-words ${values.length ? "text-slate-800" : optional ? "text-slate-500" : "text-amber-700"}`}>
      {values.length ? <ul className="space-y-1">{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul> : missing}
    </dd>
  </div>;
}

export function BusinessEvidenceCard({ node }: { node: WorkflowNode }) {
  const spec = record(node.businessSpec);
  const grounding = record(spec?.grounding);
  const executability = record(spec?.executability);
  const evidence = rows(spec?.evidence);
  const inputs = rows(spec?.inputs, ["label", "path"]);
  const rules = rows(spec?.rules, ["label", "text"]);
  const outputs = rows(spec?.outputs, ["label", "path"]);
  const doneWhen = rows(spec?.doneWhen);
  const sources = rows(executability?.sources, ["label"]);
  const missingSources = rows(executability?.missingSources, ["question", "detail"]);
  const sourceStatus = text(executability?.status);
  const objective = recordedBusinessObjective(node);

  return <section aria-label="业务依据与完成标准" className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-4 text-xs leading-5">
    <div className="flex items-start gap-2.5">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-indigo-700"><ShieldCheck className="size-4" /></span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">业务依据与完成标准</h3>
        <p className="mt-1 text-slate-600">以下是流程草稿记录的依据。修改步骤后，这些记录可能不再适用；发布前请核对实际来源与完成标准。</p>
      </div>
    </div>
    {!spec ? <p role="status" className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800"><CircleAlert className="mt-0.5 size-4 shrink-0" />这一步还没有业务规格。设计检查会指出缺少的需求证据与完成标准。</p> : <>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="草稿核对状态">
        <span className={`rounded-full px-2.5 py-1 font-medium ${grounding?.status === "weak" ? "bg-amber-100 text-amber-900" : "bg-white text-indigo-800"}`}>
          {statusLabel(grounding?.status, {
            grounded: "草稿已关联需求",
            "execution-grounded": "草稿有执行契约依据",
            weak: "需求依据待补充",
            structural: "结构性步骤",
          }, "需求依据未核对")}
        </span>
        <span className={`rounded-full px-2.5 py-1 font-medium ${sourceStatus === "blocked" ? "bg-amber-100 text-amber-900" : "bg-white text-indigo-800"}`}>
          {statusLabel(sourceStatus, { executable: "设计时来源检查通过", blocked: "设计时来源检查受阻" }, "来源尚未核对")}
        </span>
      </div>
      <dl className="mt-1">
        <EvidenceRow label="为什么存在" values={objective ? [objective] : []} missing="尚未记录这一步的业务目标" />
        <EvidenceRow label="需求证据" values={evidence} missing="尚未记录明确的用户需求证据" />
        <EvidenceRow label="实际输入" values={inputs} missing="尚未记录这一步使用的输入" />
        <EvidenceRow label="业务规则" values={rules} missing="没有额外业务规则" optional />
        <EvidenceRow label="应该产出" values={outputs} missing="尚未记录具体产出" />
        <EvidenceRow label="完成标准" values={doneWhen} missing="尚未记录可观察的完成标准" />
        <EvidenceRow label={sourceStatus === "blocked" ? "待补来源" : "已记录来源"}
          values={sourceStatus === "blocked" ? missingSources : sources}
          missing={sourceStatus === "blocked" ? "来源检查受阻，请查看设计检查" : sourceStatus === "executable" ? "未记录额外来源" : "来源尚未核对；不能据此判断实际可用性"}
          optional={sourceStatus === "executable"} />
      </dl>
    </>}
  </section>;
}
