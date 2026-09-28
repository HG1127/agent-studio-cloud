"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, FileJson2, FileOutput, Play, Rocket, ShieldCheck } from "lucide-react";
import type { AgentInputField, AgentManifest } from "@/contracts/manifest";
import { startRunAction } from "@/server/actions/start-run";

function fieldLabel(field: AgentInputField, index: number): string {
  return field.label?.trim() || `业务信息 ${index + 1}`;
}

export function RunLauncher({
  agentId,
  inputFields,
  outputFields,
  hasProductionVersion = true,
  productionVersion,
}: {
  agentId: string;
  inputFields?: AgentInputField[];
  outputFields?: NonNullable<AgentManifest["outputContract"]>["fields"];
  hasProductionVersion?: boolean;
  productionVersion?: number | null;
}) {
  const router = useRouter();
  const [inputText, setInputText] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const runningRef = useRef(false);
  const requestRef = useRef<{ requestId: string; input: Record<string, unknown> } | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const usesFieldForm = Boolean(inputFields?.length);

  function parseInput(): Record<string, unknown> | null {
    if (usesFieldForm && inputFields) {
      const input: Record<string, unknown> = {};
      for (const [index, field] of inputFields.entries()) {
        const raw = fieldValues[field.name] ?? "";
        if (!raw.trim()) {
          if (field.required) setError(`请填写${fieldLabel(field, index)}`);
          if (field.required) return null;
          continue;
        }
        if (field.type === "number") {
          const value = Number(raw);
          if (!Number.isFinite(value)) {
            setError(`${fieldLabel(field, index)}必须是数字`);
            return null;
          }
          input[field.name] = value;
        } else if (field.type === "boolean") {
          input[field.name] = raw === "true";
        } else if (field.type === "object" || field.type === "array") {
          try {
            const value = JSON.parse(raw) as unknown;
            if (field.type === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) throw new Error();
            input[field.name] = value;
          } catch {
            setError(`${fieldLabel(field, index)}的格式不正确`);
            return null;
          }
        } else {
          input[field.name] = raw;
        }
      }
      return input;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputText);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  }

  async function handleRun() {
    if (runningRef.current) return;
    setError(null);
    const input = requestRef.current?.input ?? parseInput();
    if (!input) {
      if (!usesFieldForm) setError("请输入正确的 JSON 格式");
      return;
    }
    runningRef.current = true;
    const request = requestRef.current ?? { requestId: crypto.randomUUID(), input };
    requestRef.current = request;
    setPending(true);
    try {
      const result = await startRunAction({ agentId, input: request.input, requestId: request.requestId });
      requestRef.current = null;
      setUncertain(false);
      if (result.ok) router.push(`/runs/${result.runId}`);
      else setError(result.error);
    } catch {
      setUncertain(true);
      setError("暂时无法确认是否已创建运行。请按原输入核对上次请求，或先查看该助手的运行记录。");
    } finally {
      runningRef.current = false;
      setPending(false);
    }
  }

  return (
    <section id="run" aria-labelledby="run-launcher-title" className="content-card scroll-mt-32 overflow-hidden p-0 sm:p-0">
      <header className="flex flex-col gap-4 border-b border-slate-100 bg-gradient-to-br from-white to-indigo-50/70 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
            <Play aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="eyebrow">真实任务验证</p>
            <h2 id="run-launcher-title" className="mt-1 text-lg font-bold text-slate-950">试运行</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">提交一条业务输入，系统会冻结正式版本并保存步骤证据、人工决定和最终结果。</p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${hasProductionVersion ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {hasProductionVersion ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <Rocket aria-hidden="true" className="size-3.5" />}
          {hasProductionVersion ? (productionVersion ? `正式版本 V${productionVersion}` : "正式版本已就绪") : "尚无正式版本"}
        </span>
      </header>

      {!hasProductionVersion ? (
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <Rocket aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
              <div>
                <h3 className="text-sm font-semibold text-amber-950">先发布一个正式版本</h3>
                <p className="mt-1 text-sm leading-6 text-amber-800">试运行只能使用已经冻结的正式版本，避免草稿变化影响执行证据。</p>
              </div>
            </div>
            <Link href="#versions" className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900">前往版本发布</Link>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); void handleRun(); }} className="p-5 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              {usesFieldForm ? inputFields!.map((field, index) => (
                <label key={field.name} className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  <span>{fieldLabel(field, index)}<span className="ml-1 text-xs font-normal text-slate-400">（{field.required ? "必填" : "选填"}）</span></span>
                  {field.type === "boolean" ? (
                    <select value={fieldValues[field.name] ?? ""} disabled={pending || uncertain} onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100">
                      <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
                    </select>
                  ) : field.type === "object" || field.type === "array" ? (
                    <textarea value={fieldValues[field.name] ?? ""} rows={4} placeholder={field.type === "array" ? "[]" : "{}"} disabled={pending || uncertain}
                      onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  ) : (
                    <input type={field.type === "number" ? "number" : "text"} value={fieldValues[field.name] ?? ""} disabled={pending || uncertain}
                      onChange={(event) => setFieldValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  )}
                </label>
              )) : (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
                  <span className="flex items-center gap-2"><FileJson2 aria-hidden="true" className="size-4 text-slate-400" />运行输入（对象格式）</span>
                  <textarea value={inputText} onChange={(event) => setInputText(event.target.value)} rows={6} disabled={pending || uncertain}
                    aria-label="运行输入（对象格式）" aria-describedby="run-json-help" className="rounded-xl border border-slate-300 bg-white p-3 font-mono text-sm shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
                  <span id="run-json-help" className="text-xs font-normal leading-5 text-slate-500">请输入一个 JSON 对象；密钥、令牌和密码会在详情页自动隐藏。</span>
                </label>
              )}
              {error ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <p>{error}</p>
                  {uncertain ? <Link href={`/runs?agent=${agentId}`} className="mt-2 inline-block font-semibold underline underline-offset-2">查看这位助手的运行记录</Link> : null}
                </div>
              ) : null}
            </div>

            <aside aria-label="本次运行说明" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck aria-hidden="true" className="size-4 text-indigo-600" />本次运行会</h3>
              <ul className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
                <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-500" />固定使用当前正式版本，不受后续草稿修改影响。</li>
                <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-500" />需要人工确认时暂停，等待负责人决定。</li>
                <li className="flex gap-2"><span aria-hidden="true" className="mt-1.5 size-1.5 shrink-0 rounded-full bg-indigo-500" />保留输入、步骤、结果和确认记录供追溯。</li>
              </ul>
              {outputFields?.length ? <div className="mt-4 border-t border-slate-200 pt-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><FileOutput aria-hidden="true" className="size-4 text-indigo-600" />完成后可查看与复制</h4>
                <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-600">
                  {outputFields.slice(0, 4).map((field, index) => <li key={field.path} className="break-words">{field.label?.trim() || `交付内容 ${index + 1}`}</li>)}
                </ul>
                {outputFields.length > 4 ? <p className="mt-1 text-xs text-slate-500">另有 {outputFields.length - 4} 项交付内容</p> : null}
              </div> : null}
            </aside>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p id="run-safety-note" className="text-xs leading-5 text-slate-500">{uncertain ? "核对会沿用上次提交的输入与请求标识；确认结果前不能修改本次输入。" : "提交后会创建一条新的运行记录，并自动打开详情页。"}</p>
            <button type="submit" disabled={pending} aria-describedby="run-safety-note" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300">
              <Play aria-hidden="true" className="size-4" />{pending ? (uncertain ? "正在核对上次请求…" : "正在创建运行记录…") : uncertain ? "核对上次启动" : "开始试运行"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
