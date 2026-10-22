import type { RunStepView } from "@/contracts/run";
import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { CopyResultButton } from "./CopyResultButton";
import { StructuredRunValue } from "./StructuredRunValue";

const INTERNAL_REFERENCES = new Set([
  "id", "runId", "parentRunId", "childRunId", "workflowRunId", "workflowId", "nodeId", "nodeIds",
  "agentId", "versionId", "workspaceId", "createdBy", "sourceId", "connectionId", "stepId", "eventKey",
]);
const CONDITION_REFERENCES = new Set([...INTERNAL_REFERENCES, "next", "matched"]);

function formatStepDate(value: RunStepView["startedAt"]): string {
  if (!value) return "尚无记录";
  if (Number.isNaN(value.getTime())) return "时间记录不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(value);
}

function readOutput(value: RunStepView["output"]) {
  if (value === null || value === undefined) return null;
  try {
    const safe = redactSensitiveData(value);
    const json = JSON.stringify(safe, null, 2);
    return json === undefined ? { readable: false as const } : { readable: true as const, value: safe, json };
  } catch {
    return { readable: false as const };
  }
}

function emptyOutputLabel(value: unknown): string | null {
  if (value === "") return "已保存空文字。";
  if (Array.isArray(value) && value.length === 0) return "已保存空列表。";
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return "已保存空对象。";
  return null;
}

export function RunStepRecord({ step }: { step: RunStepView }) {
  const output = readOutput(step.output);
  const emptyLabel = output?.readable ? emptyOutputLabel(output.value) : null;
  return <details data-step-record={step.id} data-step-node={step.nodeId} aria-label={(step.nodeTitle ?? "未命名步骤") + "的执行记录"} open={step.status === "failed" || Boolean(step.error)} className="mt-2 w-full min-w-0 scroll-mt-24 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
    <summary className="cursor-pointer text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">查看执行记录与步骤产出</summary>
    <dl className="mt-3 grid min-w-0 gap-3 text-xs sm:grid-cols-3">
      <div><dt className="text-slate-500">尝试次数</dt><dd className="mt-1 text-slate-800">{step.attempt !== null && step.attempt > 0 ? "已记录 " + step.attempt + " 次尝试" : "暂无尝试次数记录"}</dd></div>
      <div><dt className="text-slate-500">本条开始时间</dt><dd className="mt-1 text-slate-800">{formatStepDate(step.startedAt)}</dd></div>
      <div><dt className="text-slate-500">本条结束时间</dt><dd className="mt-1 text-slate-800">{formatStepDate(step.finishedAt)}</dd></div>
    </dl>
    <p className="mt-2 text-xs leading-5 text-slate-500">时间为北京时间，仅代表当前步骤记录；不包含每次尝试的完整经过。</p>
    {step.error ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800"><p className="font-semibold">已保存的失败原因</p><p role="alert" className="mt-1 whitespace-pre-wrap break-words">{redactSensitiveText(step.error)}</p></div> : step.status === "failed" ? <p className="mt-3 text-xs leading-5 text-amber-800">这个步骤标记为失败，但未保存失败原因。请结合执行轨迹核对，不能仅凭步骤状态判断原因。</p> : null}
    <section aria-label="已保存的步骤产出" className="mt-4 min-w-0 space-y-3 border-t border-slate-200 pt-3">
      <h3 className="text-sm font-semibold text-slate-900">已保存的步骤产出</h3>
      <p className="text-xs leading-5 text-slate-500">这是执行过程记录，不是本次最终交付，也不代表安全检查或质量验收通过。</p>
      {output === null ? <p className="text-sm leading-6 text-slate-600">{step.status === "succeeded" ? "此步骤已标记完成，但没有可核对的产出内容。请结合执行轨迹与最终结果核对，不据此推断业务交付完成。" : "当前记录没有可核对的步骤产出。请结合执行状态与轨迹核对，不从当前流程草稿补造内容。"}</p> : !output.readable ? <p role="alert" className="text-sm leading-6 text-amber-900">步骤产出暂时无法显示。执行时间和已保存的失败原因仍可核对，可重新读取或尝试下载运行报告。</p> : <>
        {step.status !== "succeeded" ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">已有产出不代表这个步骤已成功完成，请先核对当前状态与失败原因。</p> : null}
        <div role="group" aria-label="步骤产出预览" className="max-h-64 min-w-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3">
          {emptyLabel ? <p className="text-sm text-slate-600">{emptyLabel}</p> : <StructuredRunValue value={output.value} maxEntries={10} excludedKeys={step.nodeType === "condition" ? CONDITION_REFERENCES : INTERNAL_REFERENCES} />}
        </div>
        <details className="min-w-0 space-y-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">查看步骤数据（开发者数据）</summary>
          <p className="text-xs leading-5 text-slate-500">预览每层最多十项；原始数据与复制保留完整脱敏内容。常见敏感信息已隐藏，深层内容可能省略；不是完整的数据安全审查。</p>
          <CopyResultButton key={output.json} result={null} text={output.json} label="复制脱敏步骤数据" />
          <pre className="max-h-80 min-w-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">{output.json}</pre>
        </details>
      </>}
    </section>
  </details>;
}
