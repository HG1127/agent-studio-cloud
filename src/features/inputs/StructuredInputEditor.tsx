import { useId, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import type { AgentInputField } from "@/contracts/manifest";
import type { JsonStorageValue, JsonStorageRecord } from "@/contracts/json";
import { MAX_RUN_INPUT_BYTES } from "@/contracts/run";
import {
  MAX_LOCAL_STRUCTURED_IMPORT_BYTES, STRUCTURED_IMPORT_PREVIEW_ROWS, STRUCTURED_INPUT_PAGE_SIZE,
  addStructuredField, appendStructuredRow, editStructuredCell, parseStructuredImport,
  readStructuredValue, removeStructuredRow, structuredCellText, structuredCellType,
  structuredColumns, structuredRows, validateStructuredValue,
  type StructuredCellType, type StructuredImportFormat, type StructuredValue,
} from "./structured-input";

export type StructuredInputEditorProps = {
  field: AgentInputField; label: string; value: string; revision: number; disabled: boolean;
  onApply: (nextText: string, expectedRevision: number) => boolean;
  onPendingChange: (owner: string, sourceRevision: number, pending: boolean) => void;
};
const TYPES: Record<StructuredCellType, string> = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表", null: "空值" };
type DraftBase = { id: number; revision: number; generation: number; error: string | null };
type Draft = DraftBase & (
  { kind: "cell"; row: number; key: string | null; type: StructuredCellType; text: string }
  | { kind: "add-field"; name: string; type: StructuredCellType; text: string }
  | { kind: "add-row"; type: StructuredCellType; text: string }
  | { kind: "remove-row"; row: number }
  | { kind: "import"; text: string; format: StructuredImportFormat; preview: StructuredValue | null; reading: boolean; fileName: string | null }
);
type DraftInput =
  { kind: "cell"; row: number; key: string | null; type: StructuredCellType; text: string }
  | { kind: "add-field"; name: string; type: StructuredCellType; text: string }
  | { kind: "add-row"; type: StructuredCellType; text: string }
  | { kind: "remove-row"; row: number }
  | { kind: "import"; text: string; format: StructuredImportFormat; preview: StructuredValue | null; reading: boolean; fileName: string | null };

function isRecord(value: JsonStorageValue | undefined): value is JsonStorageRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function showValue(value: JsonStorageValue | undefined): string {
  return value === undefined ? "尚无此字段" : value === null ? "空值" : typeof value === "boolean" ? value ? "是" : "否"
    : typeof value === "object" ? Array.isArray(value) ? `列表（${value.length} 项）` : `对象（${Object.keys(value).length} 个字段）` : String(value);
}

export function StructuredInputEditor(props: StructuredInputEditorProps) {
  return <StructuredEditorSession key={JSON.stringify([props.field.name, props.field.type, props.revision, props.value, props.disabled])} {...props} />;
}

function StructuredEditorSession({ field, label, value, revision, disabled, onApply, onPendingChange }: StructuredInputEditorProps) {
  const owner = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [page, setPage] = useState(0);
  const [columnPage, setColumnPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false), generation = useRef(0), nextDraft = useRef(0), readNonce = useRef(0);
  const active = useRef<Draft | null>(null);
  const pending = useRef(false);
  const callbacks = useRef({ onApply, onPendingChange });
  const parsed = readStructuredValue(field, value);
  const rows = parsed.ok ? structuredRows(parsed.value) : [];
  const columns = parsed.ok ? structuredColumns(parsed.value) : [];
  const columnCount = 20;
  const visibleColumns = columns.slice(columnPage * columnCount, (columnPage + 1) * columnCount);
  const pageCount = Math.max(1, Math.ceil(rows.length / STRUCTURED_INPUT_PAGE_SIZE));
  const pageRows = rows.slice(page * STRUCTURED_INPUT_PAGE_SIZE, (page + 1) * STRUCTURED_INPUT_PAGE_SIZE);

  useLayoutEffect(() => { callbacks.current = { onApply, onPendingChange }; });
  useLayoutEffect(() => {
    mounted.current = true; generation.current += 1;
    const committed = generation.current;
    queueMicrotask(() => { if (mounted.current && generation.current === committed && active.current === null) setDraft(null); });
    return () => {
      mounted.current = false; generation.current += 1; readNonce.current += 1; active.current = null;
      if (pending.current) { pending.current = false; callbacks.current.onPendingChange(owner, revision, false); }
    };
  }, [owner, revision]);

  function canWork() { return mounted.current && !disabled; }
  function currentDraft(id: number) {
    const current = active.current;
    return canWork() && current?.id === id && current.revision === revision && current.generation === generation.current ? current : null;
  }
  function begin(input: DraftInput): Draft | null {
    if (!canWork() || active.current) return null;
    const next: Draft = { ...input, id: ++nextDraft.current, revision, generation: generation.current, error: null };
    active.current = next; pending.current = true;
    callbacks.current.onPendingChange(owner, revision, true);
    if (currentDraft(next.id)) { setDraft(next); setNotice(null); return next; }
    return null;
  }
  function change(id: number, update: (current: Draft) => Draft) {
    const current = currentDraft(id);
    if (!current) return;
    readNonce.current += 1;
    const next = update(current); active.current = next; setDraft(next);
  }
  function cancel(id: number) {
    if (!currentDraft(id)) return;
    active.current = null; readNonce.current += 1; setDraft(null); setNotice("本次本地草稿已取消，原输入没有被替换。");
    if (pending.current) { pending.current = false; callbacks.current.onPendingChange(owner, revision, false); }
  }
  function apply(id: number) {
    const current = currentDraft(id);
    if (!current || current.kind === "import" && current.reading) return;
    let result: ReturnType<typeof validateStructuredValue>;
    if (current.kind === "import") {
      if (current.preview === null) { change(id, (next) => ({ ...next, error: "请先预览资料，再确认替换。" })); return; }
      result = validateStructuredValue(field, current.preview);
    } else if (!parsed.ok) result = parsed;
    else if (current.kind === "cell") result = editStructuredCell(field, parsed.value, current.row, current.key, current.text);
    else if (current.kind === "add-field") result = addStructuredField(field, parsed.value, current.name, current.type, current.text);
    else if (current.kind === "add-row") result = appendStructuredRow(field, parsed.value, current.type, current.text);
    else result = removeStructuredRow(field, parsed.value, current.row);
    if (!result.ok) { change(id, (next) => ({ ...next, error: result.error })); return; }
    let accepted = false;
    try { accepted = callbacks.current.onApply(result.text, current.revision); } catch { accepted = false; }
    if (!currentDraft(id)) return;
    if (!accepted) {
      change(id, (next) => ({ ...next, error: "本次内容未应用到原输入，草稿仍保留。请先核对当前填写与状态，再决定应用或取消。" }));
      return;
    }
    active.current = null; readNonce.current += 1; setDraft(null); setNotice("已交给本页当前字段；没有保存或启动任务。");
    if (pending.current) { pending.current = false; callbacks.current.onPendingChange(owner, current.revision, false); }
  }
  function startCell(row: number, key: string | null) {
    if (!parsed.ok || !canWork() || active.current) return;
    const original = key === null ? rows[row] : isRecord(rows[row]) ? rows[row][key] : undefined;
    begin({ kind: "cell", row, key, type: structuredCellType(original), text: structuredCellText(original) });
  }
  function preview(id: number) {
    const current = currentDraft(id);
    if (!current || current.kind !== "import" || current.reading) return;
    const result = parseStructuredImport(field, current.text, current.format);
    change(id, (next) => next.kind === "import" ? { ...next, preview: result.ok ? result.value : null, error: result.ok ? null : result.error } : next);
  }
  function openImport() {
    begin({ kind: "import", text: "", format: "auto", preview: null, reading: false, fileName: null });
  }
  function emptyPreview() {
    if (field.type !== "object" && field.type !== "array") return;
    begin({ kind: "import", text: field.type === "array" ? "[]" : "{}", format: "json", preview: field.type === "array" ? [] : {}, reading: false, fileName: null });
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>, id: number) {
    const current = currentDraft(id);
    if (!current || current.kind !== "import") return;
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const format: StructuredImportFormat = file.name.toLowerCase().endsWith(".json") ? "json" : file.name.toLowerCase().endsWith(".tsv") ? "tsv" : file.name.toLowerCase().endsWith(".csv") ? "csv" : "auto";
    change(id, (next) => next.kind === "import" ? { ...next, format, preview: null, reading: true, fileName: file.name, error: null } : next);
    const nonce = ++readNonce.current;
    if (!/\.(?:csv|tsv|json|txt)$/i.test(file.name) || file.size > MAX_LOCAL_STRUCTURED_IMPORT_BYTES) {
      const error = file.size > MAX_LOCAL_STRUCTURED_IMPORT_BYTES ? "文件超过本地 2MB 读取安全上限；运行输入仍限制为 100 KB，没有读取或截断文件。"
        : "只读取本地 CSV、TSV、JSON 或文本资料，不解析文档、扫描件或附件。";
      change(id, (next) => next.kind === "import" ? { ...next, reading: false, error } : next);
      return;
    }
    try {
      const text = await file.text();
      if (!currentDraft(id) || readNonce.current !== nonce) return;
      const result = parseStructuredImport(field, text, format);
      change(id, (next) => next.kind === "import" ? { ...next, text, reading: false, preview: result.ok ? result.value : null, error: result.ok ? null : result.error } : next);
    } catch {
      if (!currentDraft(id) || readNonce.current !== nonce) return;
      change(id, (next) => next.kind === "import" ? { ...next, reading: false, error: "本地文件暂时无法读取。原输入没有被替换，仍可粘贴资料或取消本次导入。" } : next);
    }
  }

  function editText(text: string) {
    if (!draft) return;
    change(draft.id, (current) => current.kind === "cell" || current.kind === "add-row" || current.kind === "add-field" ? { ...current, text, error: null } : current);
  }
  const isStructured = field.type === "object" || field.type === "array";
  const editing = draft?.kind === "cell" || draft?.kind === "add-row" || draft?.kind === "add-field" ? draft : null;
  const draftTitle = draft?.kind === "import" ? "本次资料导入" : draft?.kind === "remove-row" ? "确认删除列表记录" : "本次结构化编辑";
  const applyLabel = draft?.kind === "cell" ? "应用单元格编辑" : draft?.kind === "add-field" ? "添加字段到原输入" : draft?.kind === "add-row" ? "添加条目到原输入" : draft?.kind === "remove-row" ? "确认删除这条" : "确认替换当前资料";
  const style = "min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <section aria-labelledby={`${owner}-title`} className="mt-3 min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
    <h4 id={`${owner}-title`} className="text-sm font-semibold text-slate-800">{label}结构化录入</h4>
    <p className="text-xs leading-5 text-slate-600">仅整理本页输入，不保存或启动任务。原始数据编辑入口仍由上方表单保留；类型只取自当前值，不推断业务列类型。</p>
    {!parsed.ok ? <p aria-live="polite" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">{parsed.error}</p> : <>
      <p className="text-xs leading-5 text-slate-600">{field.type === "array" ? `已读取 ${rows.length} 条记录；每页最多展示 ${STRUCTURED_INPUT_PAGE_SIZE} 条，其他记录仍完整保留。` : `已读取 ${columns.length} 个业务字段，应用时保留没有修改的全部内容。`}</p>
      {page >= pageCount ? <p className="text-sm text-amber-900">当前页已没有记录。<button type="button" disabled={disabled || Boolean(draft)} onClick={() => { if (canWork() && !active.current) setPage(0); }} className="ml-2 underline">回到记录第一页</button></p> : <div role="region" aria-label={`${label}记录横向查看区`} tabIndex={0} className="max-w-full overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table aria-label={`${label}当前记录`} className="min-w-full text-left text-xs">
          <thead><tr><th className="whitespace-nowrap p-2">记录</th><th className="min-w-40 p-2">整条内容</th>{visibleColumns.map((key) => <th key={key} className="min-w-44 break-words p-2">{key}</th>)}{field.type === "array" ? <th className="whitespace-nowrap p-2">操作</th> : null}</tr></thead>
          <tbody>{pageRows.map((row, position) => {
            const rowIndex = page * STRUCTURED_INPUT_PAGE_SIZE + position;
            return <tr key={rowIndex} className="border-t border-slate-100 align-top">
              <th scope="row" className="whitespace-nowrap p-2">第 {rowIndex + 1} 条</th>
              <td className="p-2"><span className="block max-w-64 whitespace-pre-wrap break-words">{showValue(row)}</span><button type="button" disabled={disabled || Boolean(draft)} aria-label={`编辑${label}第 ${rowIndex + 1} 条内容`} onClick={() => startCell(rowIndex, null)} className="mt-1 font-semibold text-indigo-700 underline disabled:opacity-50">编辑内容</button></td>
              {visibleColumns.map((key) => <td key={key} className="p-2"><span className="block max-w-64 whitespace-pre-wrap break-words">{isRecord(row) ? showValue(row[key]) : "此条不是对象记录"}</span>{isRecord(row) ? <button type="button" disabled={disabled || Boolean(draft)} aria-label={`编辑${label}第 ${rowIndex + 1} 条的${key}`} onClick={() => startCell(rowIndex, key)} className="mt-1 font-semibold text-indigo-700 underline disabled:opacity-50">编辑此字段</button> : null}</td>)}
              {field.type === "array" ? <td className="whitespace-nowrap p-2"><button type="button" disabled={disabled || Boolean(draft)} aria-label={`删除${label}第 ${rowIndex + 1} 条`} onClick={() => begin({ kind: "remove-row", row: rowIndex })} className="font-semibold text-red-700 underline disabled:opacity-50">删除这条</button></td> : null}
            </tr>;
          })}</tbody>
        </table>
        {rows.length === 0 ? <p className="p-3 text-xs text-slate-600">当前列表没有记录，可明确添加新条目或预览导入资料。</p> : null}
      </div>}
      {field.type === "array" && pageCount > 1 ? <nav aria-label={`${label}记录翻页`} className="flex flex-wrap items-center gap-3 text-xs">
        <button type="button" disabled={disabled || Boolean(draft) || page <= 0} onClick={() => { if (canWork() && !active.current && page > 0) setPage((current) => current - 1); }}>上一页记录</button>
        <span>第 {page + 1} / {pageCount} 页</span>
        <button type="button" disabled={disabled || Boolean(draft) || page + 1 >= pageCount} onClick={() => { if (canWork() && !active.current && page + 1 < pageCount) setPage((current) => current + 1); }}>下一页记录</button>
      </nav> : null}
      {columns.length > columnCount ? <nav aria-label={`${label}业务字段翻页`} className="flex flex-wrap items-center gap-3 text-xs"><span>本页仅展示 {visibleColumns.length} 列，其余业务字段仍保留。</span>
        <button type="button" disabled={disabled || Boolean(draft) || columnPage <= 0} onClick={() => { if (canWork() && !active.current && columnPage > 0) setColumnPage((current) => current - 1); }}>上一组字段</button>
        <button type="button" disabled={disabled || Boolean(draft) || (columnPage + 1) * columnCount >= columns.length} onClick={() => { if (canWork() && !active.current && (columnPage + 1) * columnCount < columns.length) setColumnPage((current) => current + 1); }}>下一组字段</button>
      </nav> : null}
    </>}
    <div className="flex flex-wrap gap-2">
      {parsed.ok ? field.type === "array" ? <button type="button" disabled={disabled || Boolean(draft)} onClick={() => begin({ kind: "add-row", type: "string", text: "" })} className={style}>添加一条</button> : <button type="button" disabled={disabled || Boolean(draft)} onClick={() => begin({ kind: "add-field", name: "", type: "string", text: "" })} className={style}>添加业务字段</button> : null}
      <button type="button" disabled={disabled || Boolean(draft) || !isStructured} onClick={openImport} className={style}>从表格或本地文件导入</button>
      {!parsed.ok && isStructured ? <button type="button" disabled={disabled || Boolean(draft)} onClick={emptyPreview} className={style}>{field.type === "array" ? "预览空列表替换" : "预览空对象替换"}</button> : null}
    </div>
    {notice ? <p role="status" className="text-xs leading-5 text-slate-600">{notice}</p> : null}
    {draft ? <div role="group" aria-label={`${label}${draftTitle}`} className="space-y-3 rounded-lg border border-indigo-200 bg-white p-3">
      <h5 className="text-sm font-semibold text-slate-900">{draftTitle}</h5>
      <p className="text-xs leading-5 text-slate-600">这份本地草稿尚未应用。应用或取消前不能启动任务；应用失败会保留草稿，不会覆盖原输入。</p>
      {draft.kind === "add-field" ? <label className="grid gap-1 text-xs font-medium text-slate-700">新增业务字段名称<input aria-label={`${label}新增业务字段名称`} disabled={disabled} value={draft.name} onChange={(event) => change(draft.id, (current) => current.kind === "add-field" ? { ...current, name: event.target.value, error: null } : current)} className={style} /></label> : null}
      {editing ? <>
        {editing.kind === "cell" ? <p className="text-xs text-slate-600">第 {editing.row + 1} 条{editing.key === null ? "的内容" : `的业务字段「${editing.key}」`} · 当前类型：{TYPES[editing.type]}</p> : <label className="grid gap-1 text-xs font-medium text-slate-700">新内容类型<select aria-label={`${label}新内容类型`} disabled={disabled} value={editing.type} onChange={(event) => {
          const type = event.target.value as StructuredCellType;
          if (!Object.hasOwn(TYPES, type)) return;
          change(editing.id, (current) => current.kind === "add-field" || current.kind === "add-row" ? { ...current, type, text: type === "null" ? "null" : current.text, error: null } : current);
        }} className={style}>{Object.entries(TYPES).map(([type, title]) => <option key={type} value={type}>{title}</option>)}</select></label>}
        <label className="grid gap-1 text-xs font-medium text-slate-700">本次编辑内容{editing.type === "boolean" ? <select aria-label={`${label}本次编辑内容`} disabled={disabled} value={editing.text} onChange={(event) => editText(event.target.value)} className={style}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
          : <textarea aria-label={`${label}本次编辑内容`} rows={editing.type === "object" || editing.type === "array" ? 5 : 3} disabled={disabled} readOnly={editing.type === "null"} value={editing.text} onChange={(event) => editText(event.target.value)} className={style} />}</label>
        {editing.type === "object" || editing.type === "array" || editing.type === "null" ? <p className="text-xs leading-5 text-slate-500">结构内容使用数据格式填写，不生成样例；如需改变已有值的类型，请使用父表单保留的原始数据入口。</p> : null}
      </> : null}
      {draft.kind === "remove-row" ? <p className="text-sm leading-6 text-amber-900">将从当前字段删除第 {draft.row + 1} 条。其他记录保持原样；取消不会删除任何内容。</p> : null}
      {draft.kind === "import" ? <>
        <p className="text-xs leading-5 text-slate-600">本地读取 CSV、TSV、JSON 或文本，不上传附件，不解析文档或扫描件。CSV/TSV 首行是业务字段名，所有单元格保留为文字，不猜数字、是或否及前导零。</p>
        <label className="grid gap-1 text-xs font-medium text-slate-700">资料格式<select aria-label={`${label}资料格式`} disabled={disabled || draft.reading} value={draft.format} onChange={(event) => {
          const format = event.target.value as StructuredImportFormat;
          if (!["auto", "csv", "tsv", "json"].includes(format)) return;
          change(draft.id, (current) => current.kind === "import" ? { ...current, format, preview: null, error: null } : current);
        }} className={style}><option value="auto">自动识别表格或对象数据</option><option value="csv">逗号分隔表格（CSV）</option><option value="tsv">制表符分隔表格（TSV）</option><option value="json">结构化数据（JSON）</option></select></label>
        <label className="grid gap-1 text-xs font-medium text-slate-700">粘贴本地资料<textarea aria-label={`粘贴${label}资料`} rows={5} disabled={disabled || draft.reading} value={draft.text} onChange={(event) => change(draft.id, (current) => current.kind === "import" ? { ...current, text: event.target.value, preview: null, fileName: null, error: null } : current)} className={style} /></label>
        <label className="grid gap-1 text-xs font-medium text-slate-700">选择本地文本文件<input type="file" aria-label={`导入${label}本地文件`} accept=".csv,.tsv,.json,.txt" disabled={disabled} onChange={(event) => { void readFile(event, draft.id); }} className="min-w-0 text-xs" /></label>
        {draft.fileName ? <p className="break-all text-xs text-slate-600">本地文件：{draft.fileName}</p> : null}
        {draft.reading ? <p role="status" className="text-xs leading-5 text-indigo-700">正在读取本地文本；原输入尚未替换，可以取消本次导入。</p> : null}
        <button type="button" disabled={disabled || draft.reading} onClick={() => preview(draft.id)} className={style}>预览导入</button>
        {draft.preview !== null ? <div className="space-y-2 rounded-lg bg-slate-50 p-3"><p className="text-sm font-medium text-slate-800">{Array.isArray(draft.preview) ? `待替换 ${draft.preview.length} 条，以下最多预览前 ${STRUCTURED_IMPORT_PREVIEW_ROWS} 条；确认会替换完整列表，不截断其他记录。` : "待替换一组对象字段；确认替换这个字段的完整内容，不改变其他输入。"}</p><pre aria-label={`${label}导入内容预览（数据格式）`} className="max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(Array.isArray(draft.preview) ? draft.preview.slice(0, STRUCTURED_IMPORT_PREVIEW_ROWS) : draft.preview, null, 2)}</pre></div> : null}
        <p className="text-xs leading-5 text-slate-500">2MB 仅是本地文本读取安全上限，不是任务输入额度。任务输入按全部字段合计校验，仍不能超过 {MAX_RUN_INPUT_BYTES} 字节，并受共享结构限制；预览不是业务验收通过。</p>
      </> : null}
      {draft.error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-950">{draft.error}</p> : null}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={disabled || draft.kind === "import" && (draft.reading || draft.preview === null)} onClick={() => apply(draft.id)} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{applyLabel}</button><button type="button" disabled={disabled} onClick={() => cancel(draft.id)} className={style}>{draft.kind === "import" ? "取消导入" : "取消本次编辑"}</button></div>
    </div> : null}
  </section>;
}
