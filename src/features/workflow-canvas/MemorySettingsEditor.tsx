"use client";

import { WorkflowNode } from "@/contracts/workflow";

type MemorySettings = NonNullable<WorkflowNode["memory"]>;

export function MemorySettingsEditor({ label = "", value, sources, onChange }: {
  label?: string;
  value: unknown;
  sources: Array<{ id: string; title: string }>;
  onChange: (value: MemorySettings) => void;
}) {
  const parsed = WorkflowNode.in.shape.memory.safeParse(value);
  const memory = parsed.success && parsed.data
    ? { ...(value as Record<string, unknown>), ...parsed.data } : undefined;
  const fieldLabel = (field: string) => label ? `${label} ${field}` : field;
  const unavailableSource = memory?.contentFrom && memory.contentFrom !== "run_summary"
    && !sources.some((source) => source.id === memory.contentFrom);
  const fieldClass = "w-full min-w-0 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal";

  return <fieldset className="grid min-w-0 gap-2 rounded-lg border border-slate-200 p-3">
    <legend className="px-1 text-xs font-semibold text-slate-700">经验设置</legend>
    {!memory ? <p role="status" className="text-xs leading-5 text-amber-700">原经验配置缺失或不完整，尚未自动修改。请明确选择操作，重新配置这一步。</p> : null}
    <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-700">经验操作
      <select aria-label={fieldLabel("经验操作")} value={memory?.mode ?? ""} className={fieldClass}
        onChange={(event) => {
          const mode = event.target.value as MemorySettings["mode"];
          if (mode === "read") onChange({ ...memory, mode, query: memory?.query ?? "", limit: memory?.limit ?? 5 });
          if (mode === "write") onChange({ ...memory, mode, contentFrom: memory?.contentFrom ?? "run_summary" });
        }}>
        {!memory ? <option value="">请选择经验操作</option> : null}
        <option value="read">读取相关经验</option><option value="write">保存本次经验</option>
      </select>
    </label>
    {memory?.mode === "read" ? <>
      <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-700">查找内容
        <input aria-label={fieldLabel("查找内容")} value={memory.query ?? ""} placeholder="留空则使用本次输入"
          onChange={(event) => onChange({ ...memory, query: event.target.value })} className={fieldClass} />
      </label>
      <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-700">最多参考条数
        <input aria-label={fieldLabel("最多参考条数")} type="number" min={1} max={20} step={1} value={memory.limit ?? 5}
          onChange={(event) => {
            const limit = Number(event.target.value);
            onChange({ ...memory, limit: Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.round(limit))) : 5 });
          }} className={fieldClass} />
      </label>
      <p className="text-xs leading-5 text-slate-500">检索当前助手最近保存的有效经验，不读取其他助手的经验。没有相关内容时返回空结果。</p>
    </> : null}
    {memory?.mode === "write" ? <>
      <label className="grid min-w-0 gap-1 text-xs font-medium text-slate-700">保存内容来源
        <select aria-label={fieldLabel("保存内容来源")} value={memory.contentFrom || "run_summary"}
          onChange={(event) => onChange({ ...memory, contentFrom: event.target.value })} className={fieldClass}>
          <option value="run_summary">本次输入和此前已完成结果</option>
          {unavailableSource ? <option value={memory.contentFrom}>原来源当前不在可选范围（配置已保留）</option> : null}
          {sources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
        </select>
      </label>
      {unavailableSource ? <p role="status" className="text-xs leading-5 text-amber-700">原来源已保留，请核对执行顺序或重新选择；来源没有结果时，这一步会停止并报错。</p> : null}
      <p className="text-xs leading-5 text-slate-500">保存到当前助手的长期经验。所选步骤必须在此之前完成；组内只可引用本组前序结果，并行工作不能引用其他工作的组内结果。</p>
    </> : null}
  </fieldset>;
}
