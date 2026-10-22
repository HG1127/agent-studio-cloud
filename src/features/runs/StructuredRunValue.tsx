const COMMON_FIELD_LABELS: Record<string, string> = {
  content: "内容",
  detail: "详情",
  details: "明细",
  message: "说明",
  outcome: "结果",
  reason: "原因",
  status: "状态",
  summary: "摘要",
  text: "正文",
  title: "标题",
  value: "内容",
};

export function runValueLabel(key: string, index: number): string {
  if (/\p{Script=Han}/u.test(key)) return key;
  return COMMON_FIELD_LABELS[key] ?? `内容 ${index + 1}`;
}

export function StructuredRunValue({ value, depth = 0, maxEntries, excludedKeys }: { value: unknown; depth?: number; maxEntries?: number; excludedKeys?: ReadonlySet<string> }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-slate-500">暂无内容</span>;
  }
  if (typeof value === "string") {
    return <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{value}</p>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-sm text-slate-700">{typeof value === "boolean" ? (value ? "是" : "否") : value}</span>;
  }
  if (depth >= 8) {
    return <span className="text-sm text-slate-500">内容层级较深，可在下方展开原始数据查看</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-sm text-slate-500">暂无条目</span>;
    const visible = maxEntries ? value.slice(0, maxEntries) : value;
    return <ol className="space-y-2">
      {visible.map((item, index) => <li key={index} className="flex min-w-0 items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[11px] font-semibold text-slate-500">{index + 1}</span>
        <div className="min-w-0 flex-1"><StructuredRunValue value={item} depth={depth + 1} maxEntries={maxEntries} excludedKeys={excludedKeys} /></div>
      </li>)}
      {visible.length < value.length ? <li className="text-xs leading-5 text-slate-500">预览前 {visible.length} 项，另有 {value.length - visible.length} 项。完整内容可在原始数据中核对或复制。</li> : null}
    </ol>;
  }
  if (typeof value === "object") {
    const allEntries = Object.entries(value as Record<string, unknown>);
    const entries = allEntries.filter(([key]) => !excludedKeys?.has(key));
    if (entries.length === 0) return <span className="text-sm text-slate-500">{allEntries.length ? "此处只有内部关联字段，可在原始数据中核对。" : "暂无内容"}</span>;
    const visible = maxEntries ? entries.slice(0, maxEntries) : entries;
    return <div className="space-y-2"><dl className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/70 px-3">
      {visible.map(([key, item], index) => <div key={key} className="grid min-w-0 gap-1 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
        <dt className="text-xs font-semibold text-slate-500">{runValueLabel(key, index)}</dt>
        <dd className="min-w-0"><StructuredRunValue value={item} depth={depth + 1} maxEntries={maxEntries} excludedKeys={excludedKeys} /></dd>
      </div>)}
    </dl>{visible.length < entries.length ? <p className="text-xs leading-5 text-slate-500">预览前 {visible.length} 项，另有 {entries.length - visible.length} 项。完整内容可在原始数据中核对或复制。</p> : null}{entries.length < allEntries.length ? <p className="text-xs leading-5 text-slate-500">内部关联字段仅在原始数据中展示。</p> : null}</div>;
  }
  return <span className="text-sm text-slate-500">无法显示此项内容，请展开原始数据查看</span>;
}
