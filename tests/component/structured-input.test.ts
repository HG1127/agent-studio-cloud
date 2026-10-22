import { describe, expect, it } from "vitest";
import { AgentInputField } from "@/contracts/manifest";
import { MAX_RUN_INPUT_BYTES, RunInputPayload } from "@/contracts/run";
import {
  MAX_LOCAL_STRUCTURED_IMPORT_BYTES, addStructuredField, appendStructuredRow, editStructuredCell,
  parseStructuredCell, parseStructuredImport, readStructuredValue, removeStructuredRow,
  structuredCellText, structuredColumns, structuredRows, validateStructuredValue,
} from "@/features/inputs/structured-input";

const arrayField = AgentInputField.parse({ name: "records", type: "array", label: "业务记录" });
const objectField = AgentInputField.parse({ name: "details", type: "object", label: "业务资料" });

describe("结构化录入只复用共享输入与当前值类型", () => {
  it("JSON 导入与原值读取保留零、否、空值、对象、数组、长多行及业务 next/matched", () => {
    const value = [{ count: 0, confirmed: false, next: "业务下一步", matched: false, extra: null, notes: "  原文\n第二行  " + "说明".repeat(2500), items: [0, false] }];
    const parsed = parseStructuredImport(arrayField, JSON.stringify(value), "json");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value).toEqual(value); expect(JSON.parse(parsed.text)).toEqual(value);
    expect(readStructuredValue(arrayField, parsed.text)).toEqual(parsed);
    expect(structuredRows(parsed.value)).toHaveLength(1); expect(structuredColumns(parsed.value)).toEqual(Object.keys(value[0]));
  });

  it.each(["", "{bad", "null", "false", "{}"])("列表原文 %s 不被当成空数组", (text) => {
    expect(readStructuredValue(arrayField, text).ok).toBe(false);
  });
  it.each(["", "{bad", "null", "[]"])("对象原文 %s 不被当成空对象", (text) => {
    expect(readStructuredValue(objectField, text).ok).toBe(false);
  });

  it("单元格依据自身已有类型编辑，不推断业务列类型或把非法数字/布尔变默认值", () => {
    const original = [{ text: "前导零", count: 0, confirmed: false, extra: null, details: { content: "原说明" }, items: [0, false] }];
    const cases = [
      { key: "text", raw: "  001\nfalse  ", expected: "  001\nfalse  " },
      { key: "count", raw: "0", expected: 0 },
      { key: "confirmed", raw: "false", expected: false },
      { key: "extra", raw: "null", expected: null },
      { key: "details", raw: '{"content":"新说明","zero":0}', expected: { content: "新说明", zero: 0 } },
      { key: "items", raw: "[false,0]", expected: [false, 0] },
      { key: "missing", raw: "001", expected: "001" },
    ];
    for (const item of cases) {
      const next = editStructuredCell(arrayField, original, 0, item.key, item.raw);
      expect(next.ok).toBe(true);
      if (!next.ok) throw new Error(next.error);
      expect(next.value).toEqual([{ ...original[0], [item.key]: item.expected }]);
      expect(original).toEqual([{ text: "前导零", count: 0, confirmed: false, extra: null, details: { content: "原说明" }, items: [0, false] }]);
    }
    for (const [key, text] of [["count", ""], ["count", "12x"], ["confirmed", "否"], ["extra", "0"], ["details", "[]"], ["items", "{}"]]) {
      expect(editStructuredCell(arrayField, original, 0, key, text).ok).toBe(false);
    }
    expect(editStructuredCell(arrayField, original, 3, "text", "越界").ok).toBe(false);
    expect(editStructuredCell(arrayField, ["正文"], 0, "count", "0").ok).toBe(false);
  });

  it("异构列表整条编辑保留各自类型，缺失字段只作为明确填写的文字", () => {
    expect(editStructuredCell(arrayField, [0, false, "原文", null, [1]], 0, null, "2")).toMatchObject({ ok: true, value: [2, false, "原文", null, [1]] });
    expect(editStructuredCell(arrayField, [0, false], 1, null, "true")).toMatchObject({ ok: true, value: [0, true] });
    expect(structuredCellText(0)).toBe("0"); expect(structuredCellText(false)).toBe("false");
    expect(parseStructuredCell("number", "Infinity").ok).toBe(false);
    expect(parseStructuredCell("boolean", "anything").ok).toBe(false);
  });

  it("列表添加/删除与对象新增字段不灌样例、不改变未修改内容，重复或保留名不覆盖", () => {
    expect(appendStructuredRow(arrayField, [0, false], "string", "001")).toMatchObject({ ok: true, value: [0, false, "001"] });
    expect(appendStructuredRow(arrayField, [], "object", '{"金额":0,"确认":false}')).toMatchObject({ ok: true, value: [{ 金额: 0, 确认: false }] });
    expect(removeStructuredRow(arrayField, [0, false, "保留"], 1)).toMatchObject({ ok: true, value: [0, "保留"] });
    expect(removeStructuredRow(arrayField, [0], -1).ok).toBe(false);
    expect(addStructuredField(objectField, { original: "原文" }, "count", "number", "0")).toMatchObject({ ok: true, value: { original: "原文", count: 0 } });
    expect(addStructuredField(objectField, { original: "原文" }, "confirmed", "boolean", "false")).toMatchObject({ ok: true, value: { original: "原文", confirmed: false } });
    for (const name of ["", "original", "__proto__", "constructor", "prototype"]) expect(addStructuredField(objectField, { original: "原文" }, name, "string", "不得覆盖").ok).toBe(false);
  });
});

describe("CSV/TSV 本地导入不是附件服务或类型推断", () => {
  it("BOM、引号、双引号转义、多行、CRLF 保留单元格原文字，包括零/否/前导零/公式字符", () => {
    const text = '\uFEFF客户,说明,编号,确认,表达式\r\n"甲,乙","第一行\r\n第二行 ""引用""",001,false,=SUM(A1)\r\n丙,  空格原文  ,0,true,+1\r\n';
    const result = parseStructuredImport(arrayField, text, "csv");
    expect(result).toMatchObject({ ok: true, value: [
      { 客户: "甲,乙", 说明: '第一行\r\n第二行 "引用"', 编号: "001", 确认: "false", 表达式: "=SUM(A1)" },
      { 客户: "丙", 说明: "  空格原文  ", 编号: "0", 确认: "true", 表达式: "+1" },
    ] });
  });

  it("自动识别不把引号内制表符当分隔符，明确 TSV 保留空单元格", () => {
    expect(parseStructuredImport(arrayField, '"业务\t名称",备注\n甲,原文', "auto")).toMatchObject({ ok: true, value: [{ ["业务\t名称"]: "甲", 备注: "原文" }] });
    expect(parseStructuredImport(arrayField, "客户\t确认\n甲\tfalse\n\t\n", "tsv")).toMatchObject({ ok: true, value: [{ 客户: "甲", 确认: "false" }, { 客户: "", 确认: "" }] });
  });

  it("兼容跳过真正空物理行，却不丢显式全空分隔记录或引号内空行", () => {
    expect(parseStructuredImport(arrayField, "甲,乙\r\n\r\n1,2\n\n,\r\n", "csv")).toMatchObject({ ok: true, value: [{ 甲: "1", 乙: "2" }, { 甲: "", 乙: "" }] });
    expect(parseStructuredImport(arrayField, '甲,乙\n"第一行\n\n第三行",正文\n', "csv")).toMatchObject({ ok: true, value: [{ 甲: "第一行\n\n第三行", 乙: "正文" }] });
    expect(parseStructuredImport(arrayField, '甲\n""\n', "csv")).toMatchObject({ ok: true, value: [{ 甲: "" }] });
    expect(parseStructuredImport(arrayField, "甲,乙\n \n", "csv")).toMatchObject({ ok: false, error: "第 2 行的列数与表头不一致。" });
  });

  it.each([
    { text: "甲,甲\n1,2", error: "不重复" }, { text: "甲,\n1,2", error: "非空" },
    { text: "__proto__,甲\n1,2", error: "保留名称" }, { text: "constructor\n值", error: "保留名称" },
    { text: "甲,乙\n1", error: "第 2 行的列数" }, { text: '甲\n"未闭合', error: "引号未闭合" },
    { text: '甲\n"正文"多余', error: "引号后" }, { text: '甲\n前缀"引用"', error: "引号位置" },
  ])("异常表格 $text 显式拒绝而不是补列、取部分或吞行", ({ text, error }) => {
    const result = parseStructuredImport(arrayField, text, "csv");
    expect(result.ok).toBe(false); if (result.ok) throw new Error("错误表格不应通过"); expect(result.error).toContain(error);
  });

  it("对象表格只接受一条真实记录；多条不取首条，JSON 根类型必须匹配", () => {
    expect(parseStructuredImport(objectField, "业务,编号\n甲,001", "csv")).toMatchObject({ ok: true, value: { 业务: "甲", 编号: "001" } });
    expect(parseStructuredImport(objectField, "业务\n甲\n乙", "csv")).toMatchObject({ ok: false, error: expect.stringContaining("没有取第一条") });
    expect(parseStructuredImport(objectField, "[]", "json").ok).toBe(false); expect(parseStructuredImport(arrayField, "{}", "json").ok).toBe(false);
    expect(parseStructuredImport(arrayField, "[bad", "json")).toEqual({ ok: false, error: "导入的结构化数据格式不正确，原输入没有被替换。" });
  });
});

describe("共享100KiB结构边界与本地读取2MB明确分离", () => {
  it.each(["csv", "tsv"] as const)("本地2MB内的 %s 大表头外侧空白与大量物理空行不占最终输入预算", (format) => {
    const separator = format === "csv" ? "," : "\t";
    const padding = " ".repeat(110000);
    const text = "\r\n".repeat(60000) + padding + "业务" + padding + separator + "编号" + "\r\n" + "\n".repeat(110000) + "甲" + separator + "001\r\n";
    const sourceBytes = new TextEncoder().encode(text).byteLength;
    expect(sourceBytes).toBeGreaterThan(MAX_RUN_INPUT_BYTES);
    expect(sourceBytes).toBeLessThan(MAX_LOCAL_STRUCTURED_IMPORT_BYTES);
    const result = parseStructuredImport(arrayField, text, format);
    expect(result).toMatchObject({ ok: true, value: [{ 业务: "甲", 编号: "001" }] });
    if (!result.ok) throw new Error(result.error);
    expect(RunInputPayload.safeParse({ [arrayField.name]: result.value }).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify({ [arrayField.name]: result.value })).byteLength).toBeLessThan(100);
  });

  it("损坏JSON只返回固定简单中文，不透出原文本片段或原生英文解析错误", () => {
    const result = parseStructuredImport(objectField, '{"credential":"private-source-fragment",}', "json");
    expect(result).toEqual({ ok: false, error: "导入的结构化数据格式不正确，原输入没有被替换。" });
    if (result.ok) throw new Error("损坏JSON不应通过");
    expect(result.error).not.toMatch(/private-source-fragment|credential|Unexpected|SyntaxError/);
  });

  it("单字段投影按实际UTF8序列化判断精确容量，不截断原记录", () => {
    const overhead = new TextEncoder().encode(JSON.stringify({ [arrayField.name]: [{ 资料: "" }] })).byteLength;
    const room = MAX_RUN_INPUT_BYTES - overhead;
    const value = [{ 资料: "界".repeat(Math.floor(room / 3)) + "x".repeat(room % 3) }];
    expect(new TextEncoder().encode(JSON.stringify({ [arrayField.name]: value })).byteLength).toBe(MAX_RUN_INPUT_BYTES);
    expect(validateStructuredValue(arrayField, value).ok).toBe(true);
    expect(validateStructuredValue(arrayField, [{ 资料: value[0].资料 + "x" }]).ok).toBe(false);
    const parsed = parseStructuredImport(arrayField, JSON.stringify(value), "json");
    expect(parsed.ok).toBe(true); if (!parsed.ok) throw new Error(parsed.error); expect(parsed.value).toEqual(value);
    expect(RunInputPayload.safeParse({ [arrayField.name]: value, another: "额外输入" }).success).toBe(false);
  });

  it("不沿用旧1000行限制：合法1100个简单条目保留全部，超过共享2000数据项拒绝", () => {
    const value = Array.from({ length: 1100 }, (_, index) => index);
    expect(validateStructuredValue(arrayField, value)).toMatchObject({ ok: true, value });
    expect(validateStructuredValue(arrayField, Array.from({ length: 2001 }, () => 0))).toMatchObject({ ok: false, error: expect.stringContaining("2000") });
  });

  it("深度、保留键、非有限值与长字段名均由共享输入校验，而非自造业务列限制", () => {
    let nested: unknown = { text: "原文" }; for (let depth = 0; depth < 12; depth += 1) nested = { child: nested };
    expect(validateStructuredValue(objectField, { nested }).ok).toBe(false);
    expect(parseStructuredImport(objectField, '{"next":{"constructor":"保留名称"}}', "json").ok).toBe(false);
    expect(validateStructuredValue(objectField, { amount: Infinity }).ok).toBe(false);
    expect(validateStructuredValue(objectField, { ["x".repeat(101)]: 0 }).ok).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 110 }, (_, index) => [`业务列${index}`, "原文"]));
    expect(validateStructuredValue(objectField, many).ok).toBe(RunInputPayload.safeParse({ [objectField.name]: many }).success);
  });

  it("超过本地2MB文本明确不读，不将2MB当任务输入额度", () => {
    const result = parseStructuredImport(arrayField, "x".repeat(MAX_LOCAL_STRUCTURED_IMPORT_BYTES + 1));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("本地导入文本超过 2MB") });
    if (result.ok) throw new Error("本地超大文本不应通过"); expect(result.error).toContain("运行输入的上限仍是 100 KB");
  });
});
