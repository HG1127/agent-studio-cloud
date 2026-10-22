import type { AgentInputField } from "@/contracts/manifest";
import { JsonStorageValue, type JsonStorageRecord } from "@/contracts/json";
import { MAX_RUN_INPUT_BYTES, RunInputPayload } from "@/contracts/run";

export const STRUCTURED_INPUT_PAGE_SIZE = 50;
export const STRUCTURED_IMPORT_PREVIEW_ROWS = 3;
export const MAX_LOCAL_STRUCTURED_IMPORT_BYTES = 2 * 1024 * 1024;
export type StructuredValue = JsonStorageRecord | JsonStorageValue[];
export type StructuredCellType = "string" | "number" | "boolean" | "object" | "array" | "null";
export type StructuredImportFormat = "auto" | "csv" | "tsv" | "json";
type StructuredResult = { ok: true; value: StructuredValue; text: string } | { ok: false; error: string };
type CellResult = { ok: true; value: JsonStorageValue } | { ok: false; error: string };

export function structuredCellType(value: JsonStorageValue | undefined): StructuredCellType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
}

export function structuredCellText(value: JsonStorageValue | undefined): string {
  return typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value, null, 2);
}

export function validateStructuredValue(field: AgentInputField, value: unknown): StructuredResult {
  if (field.type !== "object" && field.type !== "array") return { ok: false, error: "这个字段不支持结构化编辑。" };
  if (field.type === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: field.type === "array" ? "此字段需要一个列表，不能把对象当成列表。" : "此字段需要一个对象，不能把列表或空值当成对象。" };
  }
  const bounded = RunInputPayload.safeParse({ [field.name]: value });
  if (!bounded.success) return { ok: false, error: bounded.error.issues[0]?.message ?? "内容无法按运行输入要求保存。" };
  const json = JsonStorageValue.safeParse(value);
  if (!json.success) return { ok: false, error: "内容必须是可保存的数据。" };
  return { ok: true, value: json.data as StructuredValue, text: JSON.stringify(json.data, null, 2) };
}

export function readStructuredValue(field: AgentInputField, text: string): StructuredResult {
  if (!text.trim()) return { ok: false, error: "原输入为空。请填写原始数据，或明确预览导入内容后再确认替换。" };
  try { return validateStructuredValue(field, JSON.parse(text) as unknown); }
  catch { return { ok: false, error: "原输入的格式暂时无法读取，没有把它当成空对象或空列表。" }; }
}

export function parseStructuredCell(type: StructuredCellType, text: string): CellResult {
  if (type === "string") return { ok: true, value: text };
  if (type === "number") {
    const value = text.trim() ? Number(text) : NaN;
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: "请填写有限的数字；没有把无效数字改成零。" };
  }
  if (type === "boolean") return text === "true" || text === "false"
    ? { ok: true, value: text === "true" } : { ok: false, error: "请明确选择是或否。" };
  if (type === "null") return text.trim() === "null" ? { ok: true, value: null } : { ok: false, error: "当前值是空值；如需换成其他类型，请在原始数据中修改。" };
  try {
    const value: unknown = JSON.parse(text);
    if (type === "array" ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const json = JsonStorageValue.safeParse(value);
    if (!json.success) throw new Error();
    return { ok: true, value: json.data };
  } catch { return { ok: false, error: type === "array" ? "请填写有效的列表数据，原值仍保留。" : "请填写有效的对象数据，原值仍保留。" }; }
}

export function structuredRows(value: StructuredValue): JsonStorageValue[] {
  return Array.isArray(value) ? value : [value];
}

export function structuredColumns(value: StructuredValue): string[] {
  return [...new Set(structuredRows(value).flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : []))];
}

export function editStructuredCell(field: AgentInputField, value: StructuredValue, index: number, key: string | null, text: string): StructuredResult {
  const checked = validateStructuredValue(field, value);
  if (!checked.ok) return checked;
  const rows = structuredRows(checked.value);
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return { ok: false, error: "这条记录已无法核对，没有修改原输入。" };
  const row = rows[index];
  if (key !== null && (!row || typeof row !== "object" || Array.isArray(row))) return { ok: false, error: "这一条不是对象记录，不能添加对象字段。" };
  const previous = key === null ? row : Object.hasOwn(row as JsonStorageRecord, key) ? (row as JsonStorageRecord)[key] : undefined;
  const parsed = parseStructuredCell(structuredCellType(previous), text);
  if (!parsed.ok) return parsed;
  const next = structuredRows(JSON.parse(JSON.stringify(checked.value)) as StructuredValue);
  if (key === null) next[index] = parsed.value;
  else next[index] = { ...(next[index] as JsonStorageRecord), [key]: parsed.value };
  return validateStructuredValue(field, Array.isArray(checked.value) ? next : next[0]);
}

export function addStructuredField(field: AgentInputField, value: StructuredValue, key: string, type: StructuredCellType, text: string): StructuredResult {
  const checked = validateStructuredValue(field, value);
  if (!checked.ok) return checked;
  if (Array.isArray(checked.value)) return { ok: false, error: "列表请添加条目；新增字段只用于对象。" };
  const name = key.trim();
  if (!name || ["__proto__", "constructor", "prototype"].includes(name)) return { ok: false, error: "请填写非空的业务字段名称，不能使用保留名称。" };
  if (Object.hasOwn(checked.value, name)) return { ok: false, error: "这个字段已经存在，没有覆盖原值。" };
  const parsed = parseStructuredCell(type, text);
  return parsed.ok ? validateStructuredValue(field, { ...checked.value, [name]: parsed.value }) : parsed;
}

export function appendStructuredRow(field: AgentInputField, value: StructuredValue, type: StructuredCellType, text: string): StructuredResult {
  const checked = validateStructuredValue(field, value);
  if (!checked.ok) return checked;
  if (!Array.isArray(checked.value)) return { ok: false, error: "对象请添加字段；新增条目只用于列表。" };
  const parsed = parseStructuredCell(type, text);
  return parsed.ok ? validateStructuredValue(field, [...checked.value, parsed.value]) : parsed;
}

export function removeStructuredRow(field: AgentInputField, value: StructuredValue, index: number): StructuredResult {
  const checked = validateStructuredValue(field, value);
  if (!checked.ok) return checked;
  if (!Array.isArray(checked.value) || !Number.isInteger(index) || index < 0 || index >= checked.value.length) return { ok: false, error: "这条列表记录已无法核对，没有删除原输入。" };
  return validateStructuredValue(field, checked.value.filter((_, position) => position !== index));
}

function tableRecords(text: string, format: StructuredImportFormat): JsonStorageRecord[] {
  const content = text.replace(/^\uFEFF/, "");
  let delimiter = format === "tsv" ? "\t" : ",";
  if (format === "auto") {
    let quoted = false;
    for (let index = 0; index < content.length; index += 1) {
      const char = content[index];
      if (char === '"') {
        if (quoted && content[index + 1] === '"') index += 1;
        else quoted = !quoted;
      } else if (!quoted && (char === "," || char === "\t")) { delimiter = char; break; }
      else if (!quoted && (char === "\n" || char === "\r")) break;
    }
  }
  const records: Array<{ cells: string[]; line: number }> = [];
  let cells: string[] = [], cell = "", state: "plain" | "quoted" | "closed" = "plain";
  let line = 1, rowLine = 1, endedWithBreak = false, minimumChars = 0, rowTouched = false;
  function endCell() {
    cells.push(cell); cell = ""; state = "plain";
  }
  function endRecord() {
    if (rowTouched || cells.length || cell.length || state !== "plain") {
      endCell();
      if (records.length > 0) {
        minimumChars += cells.reduce((total, value) => total + value.length + 2, 0);
        if (minimumChars > MAX_RUN_INPUT_BYTES) throw new Error("导入内容无法装入运行输入的 100 KB 上限；没有截断记录。");
      }
      records.push({ cells, line: rowLine });
    }
    cells = []; rowLine = line + 1; rowTouched = false;
  }
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    endedWithBreak = false;
    if (state === "quoted") {
      rowTouched = true;
      if (char === '"') {
        if (content[index + 1] === '"') { cell += '"'; index += 1; }
        else state = "closed";
      } else {
        cell += char;
        if (char === "\n" || char === "\r" && content[index + 1] !== "\n") line += 1;
      }
      continue;
    }
    if (char === delimiter) { rowTouched = true; endCell(); continue; }
    if (char === "\n" || char === "\r") {
      endRecord();
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      line += 1; rowLine = line; endedWithBreak = true; continue;
    }
    rowTouched = true;
    if (state === "closed") {
      if (char !== " " && char !== "\t") throw new Error(`第 ${line} 行的引号后有无法解释的内容。`);
    } else if (char === '"') {
      if (cell.length) throw new Error(`第 ${line} 行的引号位置不正确。`);
      state = "quoted";
    } else cell += char;
  }
  if (state === "quoted") throw new Error(`第 ${rowLine} 行起的表格引号未闭合。`);
  if (!endedWithBreak || cells.length || cell.length) endRecord();
  const header = records.shift()?.cells.map((name) => name.trim());
  if (!header?.length || header.some((name) => !name || ["__proto__", "constructor", "prototype"].includes(name)) || new Set(header).size !== header.length) {
    throw new Error("首行需要非空、不重复的业务字段名称，不能使用保留名称。");
  }
  return records.map((record) => {
    if (record.cells.length !== header.length) throw new Error(`第 ${record.line} 行的列数与表头不一致。`);
    return Object.fromEntries(header.map((name, index) => [name, record.cells[index]]));
  });
}

export function parseStructuredImport(field: AgentInputField, text: string, format: StructuredImportFormat = "auto"): StructuredResult {
  if (new TextEncoder().encode(text).byteLength > MAX_LOCAL_STRUCTURED_IMPORT_BYTES) return { ok: false, error: "本地导入文本超过 2MB 读取安全上限；运行输入的上限仍是 100 KB。" };
  if (!text.trim()) return { ok: false, error: "请先粘贴资料或选择本地文件，原输入仍保留。" };
  try {
    const trimmed = text.trimStart().replace(/^\uFEFF/, "");
    let value: unknown;
    if (format === "json" || format === "auto" && (trimmed.startsWith("[") || trimmed.startsWith("{"))) value = JSON.parse(trimmed) as unknown;
    else {
      const records = tableRecords(text, format);
      if (field.type === "object") {
        if (records.length !== 1) return { ok: false, error: "对象字段只能接收一条表格记录；多条记录请使用列表字段，没有取第一条冒充全部资料。" };
        value = records[0];
      } else value = records;
    }
    return validateStructuredValue(field, value);
  } catch (error) { return { ok: false, error: error instanceof SyntaxError ? "导入的结构化数据格式不正确，原输入没有被替换。" : error instanceof Error ? error.message : "本地资料暂时无法读取，原输入仍保留。" }; }
}
