import { AgentInputContract } from "@/contracts/manifest";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_RUN_INPUT_BYTES, RunInputPayload, type RunView } from "@/contracts/run";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import { validateRunInput } from "@/server/domain/runtime/run-input";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";
import { webToolInputLabel } from "./web-tool-field-label";

export function WebToolSavedInputCoverage({ run }: { run: Pick<RunView, "input" | "inputContract"> }) {
  const checked = isPassiveJsonData(run.input, MAX_RUN_INPUT_BYTES) ? RunInputPayload.safeParse(run.input) : null;
  if (!checked?.success) return <section aria-label="保存输入覆盖核对" className="min-w-0 space-y-3 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
    <h3 className="text-sm font-semibold text-slate-900">保存输入覆盖核对</h3>
    <p role="status" className="text-xs leading-5 text-amber-950">保存输入暂时无法按当前数据范围安全展示，核对状态未知。没有删改记录，请到任务详情核对。</p>
  </section>;

  const input = checked.data;
  const contract = AgentInputContract.safeParse(run.inputContract);
  const fields = contract.success ? contract.data.fields : [];
  const names = new Set(fields.map((field) => field.name));
  const additional = Object.keys(input).filter((name) => !names.has(name));
  const redacted = redactSensitiveData(input) as Record<string, unknown>;
  const recordedCount = Object.keys(input).length;

  return <section aria-label="保存输入覆盖核对" className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4">
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">保存输入覆盖核对</h3>
      <p className="text-xs leading-5 text-slate-600">只核对本次保存输入的记录情况与基础格式，不证明输入来自哪个页面，也不代表运行或业务内容通过。没有补入示例、默认值或当前版本的字段。</p>
      <p className="text-xs text-slate-500">实际保存 {recordedCount} 项输入{fields.length ? "，返回的输入约定有 " + fields.length + " 项字段。" : "，输入约定的字段情况仍需核对。"}</p>
    </div>
    {!contract.success ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">本次返回的输入约定暂时无法核对，以下按实际保存记录展示，不能据此认定没有输入约定。</p>
      : !fields.length ? <p role="status" className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">本次返回的输入约定没有字段，无法判断哪些输入已声明；这不证明当时没有约定。以下按实际保存记录逐项核对。</p> : null}
    {fields.length ? <ol aria-label="本次输入约定覆盖情况" className="space-y-3">{fields.map((field, index) => {
      const recorded = Object.hasOwn(input, field.name);
      const value = input[field.name];
      const empty = value === null || value === undefined || typeof value === "string" && !value.trim();
      const issue = recorded && !empty ? validateRunInput({ [field.name]: value }, [field]) !== null : false;
      const status = !recorded ? field.required ? "必填项未记录" : "选填项未记录"
        : empty ? field.required ? "必填项已记录空内容" : "选填项已记录空内容"
          : issue ? "已记录，基础格式不符" : "已记录，基础格式相符";
      return <li key={field.name} className="min-w-0 space-y-2 rounded-lg border border-slate-200 p-3">
        <h4 className="break-words text-sm font-semibold text-slate-900">{webToolInputLabel(field, index)}</h4>
        <p className={"text-xs leading-5 " + (!recorded && field.required || empty && field.required || issue ? "text-amber-900" : "text-slate-600")}>{status}</p>
        {recorded ? <div className="min-w-0"><StructuredRunValue value={redacted[field.name]} maxEntries={20} /></div> : null}
      </li>;
    })}</ol> : null}
    {additional.length ? <div className="space-y-3">
      {fields.length ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">这份保存记录还包含 {additional.length} 项未在返回的输入约定中声明的内容，已在下方单独保留；不能据此判断当时提交是否合法。</p> : null}
      <ol aria-label={fields.length ? "约定外的保存输入" : "按保存记录逐项核对"} className="space-y-3">{additional.map((name, index) => <li key={name} className="min-w-0 space-y-2 rounded-lg bg-slate-50 p-3">
        <h4 className="text-sm font-semibold text-slate-900">{fields.length ? "补充保存内容 " : "保存输入 "}{index + 1}</h4>
        <div className="min-w-0"><StructuredRunValue value={redacted[name]} maxEntries={20} /></div>
      </li>)}</ol>
    </div> : null}
    {recordedCount === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs leading-5 text-slate-600">本次保存输入为空，没有补造任何内容；请结合这次运行的输入约定核对。</p> : null}
    <details className="min-w-0 text-xs text-slate-600">
      <summary className="cursor-pointer font-semibold">查看完整保存输入（开发者数据）</summary>
      <p className="mt-2 leading-5">以下保留实际保存字段，敏感信息已隐藏；只供核对，不表示这些字段都符合当时的输入约定。</p>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3">{JSON.stringify(redacted, null, 2)}</pre>
    </details>
  </section>;
}
