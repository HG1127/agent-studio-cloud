"use client";

import { useRef, useState, type RefObject } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { WebToolDesignDraft } from "./web-tool-design-draft";
import { WEB_TOOL_QUOTA_FIELDS, WEB_TOOL_QUOTA_PRESETS, findWebToolQuotaPreset } from "./web-tool-design-quota";

export function WebToolQuotaPresetPicker({ draft, onApply, manualInputRef }: {
  draft: WebToolDesignDraft;
  onApply: (presetId: typeof WEB_TOOL_QUOTA_PRESETS[number]["id"]) => void;
  manualInputRef: RefObject<HTMLInputElement | null>;
}) {
  const [pendingId, setPendingId] = useState<typeof WEB_TOOL_QUOTA_PRESETS[number]["id"] | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const current = findWebToolQuotaPreset(draft);
  const pending = WEB_TOOL_QUOTA_PRESETS.find((preset) => preset.id === pendingId);
  const comparison = pending ? WEB_TOOL_QUOTA_FIELDS.map(({ key, label }) =>
    label + "：" + (Number.isFinite(draft[key]) ? String(draft[key]) : "未填写或无效") + " → " + pending.values[key]).join("；") : "";
  const card = "min-w-0 rounded-xl border p-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

  return <section className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4" aria-label="用量方案快捷填写">
    <div><h4 className="text-sm font-semibold text-slate-900">先选择用量方案，再逐项调整</h4>
      <p className="mt-1 text-xs leading-5 text-slate-500">沿用旧版的两组填写起点，只改本页草稿，不代表系统已经启用这些限制。</p></div>
    <p className="text-xs font-medium text-slate-700">按当前五项数值识别：{current?.label ?? "自定义"}</p>
    <div className="grid min-w-0 gap-2 sm:grid-cols-3">
      {WEB_TOOL_QUOTA_PRESETS.map((preset) => <button key={preset.id} type="button" aria-pressed={current?.id === preset.id}
        className={card + (current?.id === preset.id ? " border-indigo-300 bg-indigo-50 text-indigo-950" : " border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}
        onClick={(event) => {
          if (current?.id === preset.id) return;
          returnFocusRef.current = event.currentTarget;
          setPendingId(preset.id);
        }}>
        <span className="block font-semibold">{preset.label}</span>
        <span className="mt-1 block break-words text-xs leading-5">每小时 {preset.values.maxPerHour} 次 · 每天 {preset.values.maxPerDay} 次</span>
        <span className="mt-1 block break-words text-xs leading-5">并发 {preset.values.maxConcurrent} · 最长 {preset.values.maxRuntimeSeconds} 秒 · 成本额度 {preset.values.maxCostUnits}</span>
      </button>)}
      <button type="button" className={card + " border-slate-200 bg-white text-slate-700 hover:bg-slate-50"} onClick={() => {
        manualInputRef.current?.focus();
        manualInputRef.current?.scrollIntoView?.({ block: "nearest" });
      }}><span className="block font-semibold">逐项自定义</span><span className="mt-1 block text-xs leading-5">保留现有数值，从下方第一项开始调整。</span></button>
    </div>
    <ConfirmDialog open={pending !== undefined} onOpenChange={(open) => { if (!open) setPendingId(null); }}
      title="确认替换用量方案？" confirmLabel="替换五项用量" tone="warning" returnFocusRef={returnFocusRef}
      description={pending ? "将本页用量方案改为「" + pending.label + "」。" + comparison + "。只替换这五项，其他设计与预览填写保持；尚未保存或执行。" : ""}
      onConfirm={() => { if (pending) { onApply(pending.id); setPendingId(null); } }} />
  </section>;
}
