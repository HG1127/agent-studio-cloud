"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { Eye, FileText, ShieldCheck } from "lucide-react";
import { WorkspaceTabs } from "@/components/ui/WorkspaceTabs";
import { Button } from "@/components/ui/button";
import { WEB_TOOL_AUDIENCES, WEB_TOOL_LAYOUTS, type WebToolDesignDraft } from "./web-tool-design-draft";

export function WebToolLayoutPreview({ draft, values, onValueChange }: {
  draft: WebToolDesignDraft;
  values: Record<string, string>;
  onValueChange: (id: string, value: string) => void;
}) {
  const previewId = useId();
  const inputRefs = useRef<(HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null)[]>([]);
  const [feedback, setFeedback] = useState<{ text: string; source: string; issues: { index: number; message: string }[] } | null>(null);
  const inputSource = JSON.stringify({ fields: draft.fields, values });
  const currentFeedback = feedback?.source === inputSource ? feedback : null;
  useLayoutEffect(() => {
    const first = currentFeedback?.issues[0];
    if (first) inputRefs.current[first.index]?.focus();
  }, [currentFeedback]);
  // 字段改变后即使改回原值，也不能恢复旧检查或意外抢走焦点。
  if (feedback && feedback.source !== inputSource) setFeedback(null);
  function inputValue(id: string) { return Object.hasOwn(values, id) ? values[id] : ""; }
  function checkInputs() {
    const issues: { index: number; message: string }[] = [];
    draft.fields.forEach((field, index) => {
      const value = inputValue(field.id);
      let message = "";
      if (!value.trim()) {
        if (field.required) issues.push({ index, message: "请填写这一项。" });
        return;
      }
      if (field.type === "number" && !Number.isFinite(Number(value))) message = "请填写有效数字。";
      if (field.type === "boolean" && value !== "true" && value !== "false") message = "请选择是或否。";
      if (field.type === "object" || field.type === "array") {
        const expected = field.type === "array" ? "请填写结构化列表，例如 []。" : "请填写结构化对象，例如 {}。";
        try {
          const parsed: unknown = JSON.parse(value);
          if (field.type === "array" ? !Array.isArray(parsed) : parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) message = expected;
        } catch { message = expected; }
      }
      if (message) issues.push({ index, message });
    });
    setFeedback({ source: inputSource, issues, text: issues.length ? `有 ${issues.length} 项需要修改。请核对必填项及输入类型，仅在本页检查，不会发起运行。` : "本页填写检查完成，未发起运行，也没有生成结果。" });
  }
  const layout = WEB_TOOL_LAYOUTS.find((item) => item.value === draft.preset);
  const modules = draft.modules.filter((module) => module.enabled);
  function quotaText(value: number) { return Number.isFinite(value) && value > 0 ? String(value) : "待填写或检查"; }
  return <section aria-label="网页工具布局预览" className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start gap-2 border-b border-slate-100 p-4">
      <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-indigo-600" />
      <div className="min-w-0"><h3 className="text-sm font-bold text-slate-900">布局预览</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">只展示本页设计与填写，不调用助手，不代表公开页面。</p></div>
    </div>
    <div className="min-w-0 p-4"><WorkspaceTabs label="布局预览内容" tabs={[
      { id: "form", label: "输入表单", content: <div className="min-w-0 space-y-4">
        <header className="min-w-0 rounded-xl bg-indigo-50/60 p-4">
          <h4 className="break-words font-bold text-slate-900">{draft.name || "未命名网页工具"}</h4>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{draft.description || "填写工具说明后在此预览。"}</p>
        </header>
        {draft.fields.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">尚未设计输入项，可在左侧添加；没有生成示例数据。</p>
          : draft.fields.map((field, index) => {
            const id = previewId + "-" + index;
            const error = currentFeedback?.issues.find((issue) => issue.index === index)?.message;
            const hasHint = Boolean(field.description) || field.type === "object" || field.type === "array";
            const describedBy = [hasHint ? id + "-hint" : "", error ? id + "-error" : ""].filter(Boolean).join(" ") || undefined;
            const attributes = { id, "aria-required": field.required, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy };
            const control = "w-full min-w-0 rounded-lg border border-slate-200 bg-white p-2.5 text-sm outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-100 aria-invalid:border-red-400";
            return <div key={field.id} className="min-w-0 space-y-1.5">
              <label htmlFor={id} className="block break-words text-sm font-semibold text-slate-700">{field.label || "未命名输入项"}{field.required ? "（必填）" : "（选填）"}</label>
              {field.type === "boolean" ? <select {...attributes} ref={(element) => { inputRefs.current[index] = element; }} value={inputValue(field.id)} onChange={(event) => { onValueChange(field.id, event.target.value); setFeedback(null); }} className={control}>
                <option value="">请选择</option><option value="true">是</option><option value="false">否</option>
              </select> : field.type === "number" ? <input {...attributes} ref={(element) => { inputRefs.current[index] = element; }} type="number" step="any" value={inputValue(field.id)} onChange={(event) => { onValueChange(field.id, event.target.value); setFeedback(null); }} placeholder={field.placeholder} className={control} />
                : <textarea {...attributes} ref={(element) => { inputRefs.current[index] = element; }} rows={field.type === "string" && Number.isFinite(field.rows) ? Math.max(1, Math.min(12, field.rows)) : 4} value={inputValue(field.id)} onChange={(event) => { onValueChange(field.id, event.target.value); setFeedback(null); }} placeholder={field.placeholder} className={control + " resize-y"} />}
              {hasHint ? <div id={id + "-hint"} className="space-y-1">
                {field.description ? <p className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-500">{field.description}</p> : null}
                {field.type === "object" || field.type === "array" ? <p className="text-xs text-slate-500">请输入对应的结构化文本；只用于本页检查。</p> : null}
              </div> : null}
              {error ? <p id={id + "-error"} className="text-xs leading-5 text-red-700">{error}</p> : null}
            </div>;
          })}
        <Button type="button" variant="secondary" onClick={checkInputs}>检查填写</Button>
        {currentFeedback ? <p role={currentFeedback.issues.length ? "alert" : "status"} className={"rounded-lg p-3 text-xs leading-5 " + (currentFeedback.issues.length ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-600")}>{currentFeedback.text}</p> : null}
        <p className="text-xs leading-5 text-slate-500">真实调用请回到“工具管理”，使用实际发布工具与工具凭据。</p>
      </div> },
      { id: "result", label: "结果布局", content: <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><FileText aria-hidden="true" className="size-4 shrink-0" />{layout?.label}</div>
        <div aria-label="结果模块布局" className={draft.preset === "scorecard" ? "grid min-w-0 grid-cols-2 gap-3" : draft.preset === "compact" ? "min-w-0 space-y-2" : "min-w-0 space-y-4"}>
        {modules.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">尚未启用结果模块。真实运行后显示业务结果。</p>
          : modules.map((module, index) => <article key={module.id} className={"min-w-0 rounded-xl border " + (draft.preset === "compact" ? "p-3 " : "p-4 ")
            + (draft.preset === "scorecard" && module.component !== "ScoreCards" && module.component !== "MetricGrid" ? "col-span-2 " : "")
            + (module.component === "RiskCards" ? "border-amber-200 bg-amber-50/50" : draft.preset === "analysis" && index === 0 ? "border-indigo-200 bg-indigo-50/50" : "border-slate-200 bg-slate-50/50")}>
            <h4 className="break-words text-sm font-bold text-slate-800">{module.title || "未命名结果模块"}</h4>
            {module.description ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{module.description}</p> : null}
            <div aria-hidden="true" className={module.component === "ScoreCards" || module.component === "MetricGrid" ? "mt-3 grid grid-cols-2 gap-2" : "mt-3 space-y-2"}>
              {[0, 1].map((position) => <div key={position} className={"rounded bg-slate-200/70 " + (module.component === "ScoreCards" || module.component === "MetricGrid" ? "h-14" : position === 0 ? "h-3 w-3/4" : "h-3 w-1/2")} />)}
            </div><p className="mt-3 text-xs text-slate-500">真实运行后显示；当前仅为空布局。</p>
          </article>)}
        </div>
      </div> },
      { id: "access", label: "接入说明", content: <div className="min-w-0 space-y-4 text-sm leading-6 text-slate-600">
        <div className="flex items-center gap-2 font-semibold text-slate-800"><ShieldCheck aria-hidden="true" className="size-4 shrink-0" />访问设计尚未生效</div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt>设计受众</dt><dd className="break-words">{WEB_TOOL_AUDIENCES.find((item) => item.value === draft.audienceType)?.label}</dd>
          <dt>小时 / 日上限</dt><dd className="break-words">{quotaText(draft.maxPerHour)} / {quotaText(draft.maxPerDay)}</dd>
          <dt>并发 / 时长</dt><dd className="break-words">{quotaText(draft.maxConcurrent)} / {quotaText(draft.maxRuntimeSeconds)} 秒</dd>
        </dl>
        <p>公开展示、网页嵌入、站点授权与跨域、访问上限执行及工具统计尚未接入，本页不会生成可用链接、嵌入代码或统计数据。</p>
      </div> },
    ]} /></div>
  </section>;
}
