import { describe, expect, it, vi } from "vitest";
import { MAX_RUN_RESULT_BYTES, RunStatus, RunView, RunStepView, type RunView as SavedRun } from "@/contracts/run";
import { savedBusinessResultExport } from "@/features/runs/saved-business-result-export";

const runId = "00000000-0000-4000-8000-000000000111";
const agentId = "00000000-0000-4000-8000-000000000112";
const versionId = "00000000-0000-4000-8000-000000000113";
const stepId = "00000000-0000-4000-8000-000000000114";
const otherRunId = "00000000-0000-4000-8000-000000000115";
const businessId = "00000000-0000-4000-8000-000000000116";
const knownUUIDs = {
  run: "abcdef01-abcd-4abc-8abc-abcdefabcdef", agent: "abcdef02-abcd-4abc-8abc-abcdefabcdef",
  version: "abcdef03-abcd-4abc-8abc-abcdefabcdef", parent: "abcdef04-abcd-4abc-8abc-abcdefabcdef",
  step: "abcdef05-abcd-4abc-8abc-abcdefabcdef", source: "abcdef06-abcd-4abc-8abc-abcdefabcdef",
  target: "abcdef07-abcd-4abc-8abc-abcdefabcdef", business: "abcdef08-abcd-4abc-8abc-abcdefabcdef",
};
function mixedUUID(value: string) { return value.replace(/[a-f]/g, (letter, offset) => offset % 2 ? letter.toUpperCase() : letter); }
const date = new Date("2026-10-10T02:00:00.000Z");
function run(overrides: Partial<SavedRun> = {}) {
  return RunView.parse({
    id: runId, agentId, versionId, agentName: "仅供页面使用的助手名", status: "completed", sourceType: "manual",
    input: { password: "private-input-never-export" }, result: { report: "已保存业务正文" }, error: null,
    startedAt: null, finishedAt: null, outputContract: { fields: [{ path: "report", label: "业务报告", required: true }] }, ...overrides,
  });
}
function step(nodeId = "private-source", nodeType = "condition", output: unknown = { matched: "已命中", next: "private-target" }, overrides: Partial<RunStepView> = {}) {
  return RunStepView.parse({
    id: stepId, runId, nodeId, nodeType, nodeTitle: "已保存来源名称", output, status: "succeeded", attempt: 1,
    error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date, ...overrides,
  });
}
function exported(saved = run(), steps: readonly RunStepView[] = []) {
  const result = savedBusinessResultExport(saved, steps);
  expect(result.available).toBe(true);
  if (!result.available) throw new Error("Expected available export");
  return result;
}
function csvRows(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && char === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  return rows;
}
function expectUnavailable(saved: SavedRun, steps: readonly RunStepView[] = [], unavailable = false) {
  const result = savedBusinessResultExport(saved, steps, unavailable);
  expect(result.available).toBe(false);
  expect(result).not.toHaveProperty("markdown"); expect(result).not.toHaveProperty("csv");
  if (result.available) throw new Error("Expected unavailable export");
  return result.message;
}
function selectedNextRun(style: "explicit" | "legacy", value: unknown = "private-target") {
  return run({
    result: style === "explicit" ? { report: value } : { "condition-node": { next: value } },
    outputContract: { fields: [style === "explicit"
      ? { path: "report", label: "记录去向", required: true, sourceNodeId: "condition-node", sourcePath: ["next"] }
      : { path: "condition-node.next", label: "记录去向", required: true }] },
  });
}

describe("已保存业务成果的纯导出投影（未执行作者规格）", () => {
  it("32层成果经同一安全投影导出，保留分词计量与零否并隐藏个人信息", () => {
    let value: unknown = { tokenizer: "业务分词", tokenUnit: "字符", 金额: 0, 已核对: false, 联系: "buyer@example.test" };
    for (let index = 0; index < 30; index += 1) value = { 内容: value };
    const saved = run({ result: { report: value } }); const original = JSON.stringify(saved.result);
    const result = exported(saved);
    for (const text of [result.markdown, result.csv]) {
      expect(text).toContain("业务分词"); expect(text).toContain("字符"); expect(text).toContain("金额：0"); expect(text).toContain("已核对：否");
      expect(text).not.toContain("buyer@example.test"); expect(text).not.toContain("层级过深");
    }
    expect(JSON.stringify(saved.result)).toBe(original);
  });
  it("脱敏膨胀越界时整份停用，不退回未脱敏值", () => {
    const value = Object.fromEntries(Array.from({ length: 30_000 }, (_, index) => [`phone_designed_business_contact_field_${index}`, "x"]));
    expect(expectUnavailable(run({ result: value, outputContract: { fields: [] } }))).toContain("整份导出已停用");
  });
  it("复用真实已保存结果与脱敏，不导出输入、步骤原值、内部路径或当前草稿", () => {
    const saved = run({ result: { report: { 内容: "联系 buyer@example.test，凭据 sk-privatecredential123456", runId, nodeId: "private-source", fieldId: "report" }, private_unselected: "private-developer-data" } });
    const original = structuredClone(saved);
    const result = exported(saved, [step("private-source", "llm", { private: "private-step-output" })]);
    for (const text of [result.markdown, result.csv]) {
      expect(text).toContain("已隐藏敏感信息");
      expect(text).not.toMatch(/buyer@example.test|sk-privatecredential123456|private-input-never-export|private-developer-data|private-step-output|private-source/);
      expect(text).not.toContain(runId); expect(text).not.toContain(agentId); expect(text).not.toContain(versionId);
      expect(text).not.toMatch(/runId|nodeId|fieldId|"report"/);
    }
    expect(saved).toEqual(original);
  });

  it("转义JSON包装抽取正文后再次脱敏，不把推理或格式片段写入文件", () => {
    const ticks = String.fromCharCode(96).repeat(3);
    const body = '<think>private-thinking-body</think>\n' + ticks + 'json\n{"reply_suggestion":"联系 buyer\\u0040example.test，密钥 sk-privatecredential123456","internal_marker":"private-format-marker"}\n' + ticks;
    const result = exported(run({ result: { report: body } }));
    expect(result.markdown).toContain("联系 [已隐藏敏感信息]");
    expect(result.csv).toContain("联系 [已隐藏敏感信息]");
    expect(result.markdown + result.csv).not.toMatch(/buyer@example.test|sk-privatecredential123456|private-thinking-body|private-format-marker|reply_suggestion|<think>/);
  });

  it.each(["<think>private-unfinished-thinking", '{"unknown_body":"private-raw-json"}', '{"content":'])("任一正文 %s 无法安全解释，整份停用而不导出另一项或说明文字", (body) => {
    const saved = run({ result: { first: "第一项真实内容", second: body }, outputContract: { fields: [
      { path: "first", label: "第一项", required: true }, { path: "second", label: "第二项", required: true },
    ] } });
    expect(expectUnavailable(saved)).toContain("整份导出已停用");
  });

  it.each([null, undefined])("无结果 %s 不造交付，完成状态也不自动允许导出", (result) => {
    expect(expectUnavailable({ ...run(), result })).toContain("没有可导出");
  });

  it("真实契约选中的零、否、空文字、空值、空列表与空对象仍为实际已保存值", () => {
    const values = { zero: 0, no: false, text: "", empty: null, list: [], object: {} };
    const saved = run({ result: values, outputContract: { fields: Object.keys(values).map((path, index) => ({ path, label: "交付内容 " + String(index + 1), required: true })) } });
    const result = exported(saved); const rows = csvRows(result.csv);
    expect(rows[0]).toEqual(["记录状态", "交付内容", "已保存内容"]);
    expect(rows.slice(1).map((row) => row[2])).toEqual(["0", "否", '""', "空值（已保存）", "空列表（已保存）", "空对象（已保存）"]);
    expect(rows.every((row) => row.length === 3)).toBe(true);
    expect(expectUnavailable(run({ result: {}, outputContract: { fields: [] } }))).toContain("没有可导出的业务");
  });

  it("不一律删除业务next/matched、无关联UUID或数字，复杂内容仍只有一清单单元格", () => {
    const result = exported(run({ result: { report: { matched: "客户已确认", next: "下一次联系", id: businessId, 数量: -7, 明细: [{ 金额: 0, 是否同意: false }] } } }));
    const rows = csvRows(result.csv);
    expect(rows).toHaveLength(2); expect(rows[1]).toHaveLength(3);
    expect(rows[1][2]).toContain("客户已确认"); expect(rows[1][2]).toContain("下一次联系");
    expect(rows[1][2]).toContain(businessId); expect(rows[1][2]).toContain("-7");
    expect(rows[1][2]).toContain("金额：0"); expect(rows[1][2]).toContain("是否同意：否");
    expect(rows[0]).not.toContain("数量"); expect(rows[0]).not.toContain("金额");
  });

  it("业务标题与内部步骤同名不盲删业务文字；明确来源为非条件时不投射业务next/matched", () => {
    const saved = run({ result: { report: { matched: "客户已确认", next: "下一次联系", summary: "已有业务记录" } }, outputContract: { fields: [{ path: "report", label: "report", sourceNodeId: "下一次联系", required: true }] } });
    const actual = savedBusinessResultExport(saved, [step("下一次联系", "llm", { content: "不是条件输出" })]);
    expect(actual.available).toBe(true);
    if (!actual.available) throw new Error("Expected business content retained");
    expect(actual.markdown).toContain("客户已确认"); expect(actual.markdown).toContain("下一次联系");
    expect(actual.markdown).not.toContain("命中的分支：");
    const safeSaved = run({ result: { report: "下一次联系" }, outputContract: saved.outputContract });
    expect(exported(safeSaved, [step("下一次联系", "llm", { content: "记录" })]).markdown).toContain("下一次联系");
  });

  it("仅可核对同次内部关联可剔除；未知关联停用整份，不把内部编号藏到中文标签下", () => {
    const saved = run({ result: { report: { summary: "业务正文", nodeId: "private-source", targetId: "private-target", fieldPath: "report", run_id: runId } } });
    const records = [step("private-source", "llm"), step("private-target", "system")];
    const result = exported(saved, records);
    expect(result.csv).toContain("业务正文"); expect(result.csv).not.toMatch(/private-source|private-target|run_id|fieldPath/);
    expect(expectUnavailable(run({ result: { report: { summary: "业务正文", targetId: "not-verified-target" } } }), records)).toContain("内部关联");
    expect(expectUnavailable(run({ result: { report: { runId } } }))).toContain("整份导出已停用");
    expect(expectUnavailable(run({ result: { report: "正文中附有 " + runId } }))).toContain("内部关联");
    expect(expectUnavailable(run({ result: { report: { summary: "业务正文", childRunId: businessId } } }))).toContain("内部关联");
  });

  it("已证明UUID身份的全大写和混合大小写引用仍剔除，步骤归属核对也不丢同次证据", () => {
    const saved = run({ id: knownUUIDs.run, agentId: knownUUIDs.agent, versionId: knownUUIDs.version, parentRunId: knownUUIDs.parent,
      result: { report: { summary: "真实业务正文", runId: knownUUIDs.run.toUpperCase(), agentId: mixedUUID(knownUUIDs.agent),
        versionId: knownUUIDs.version.toUpperCase(), parentRunId: mixedUUID(knownUUIDs.parent), stepId: knownUUIDs.step.toUpperCase(),
        nodeId: mixedUUID(knownUUIDs.source), nodeIds: [knownUUIDs.source.toUpperCase()], targetId: mixedUUID(knownUUIDs.target), id: mixedUUID(knownUUIDs.run) } },
    });
    const records = [step(knownUUIDs.source, "llm", {}, { id: knownUUIDs.step, runId: knownUUIDs.run.toUpperCase() }),
      step(knownUUIDs.target, "system", {}, { runId: mixedUUID(knownUUIDs.run) })];
    const result = exported(saved, records);
    expect(result.markdown + result.csv).toContain("真实业务正文");
    for (const identity of Object.values(knownUUIDs).filter((value) => value !== knownUUIDs.business)) {
      expect((result.markdown + result.csv).toLowerCase()).not.toContain(identity);
    }
  });

  it.each(["upper", "mixed"] as const)("正文、交付标签、中文内容标签中已知UUID的%s变体均停用整份", (style) => {
    const identity = style === "upper" ? knownUUIDs.run.toUpperCase() : mixedUUID(knownUUIDs.run);
    const base = run({ id: knownUUIDs.run });
    expect(expectUnavailable({ ...base, result: { report: "正文引用 " + identity } })).toContain("内部关联");
    expect(expectUnavailable({ ...base, outputContract: { fields: [{ path: "report", label: "报告 " + identity, required: true }] } })).toContain("内部关联");
    expect(expectUnavailable({ ...base, result: { report: { ["关联说明 " + identity]: "已有业务正文" } } })).toContain("内部关联");
    const record = step("private-source", "llm", {}, { id: knownUUIDs.step });
    const stepIdentity = style === "upper" ? knownUUIDs.step.toUpperCase() : mixedUUID(knownUUIDs.step);
    expect(expectUnavailable(run({ result: { report: "正文引用 " + stepIdentity } }), [record])).toContain("内部关联");
  });

  it("未关联业务UUID大小写原样保留，短步骤名不全局大小写归并或删除业务文字", () => {
    const identity = mixedUUID(knownUUIDs.business);
    const saved = run({ id: knownUUIDs.run, result: { report: { id: identity, 内容: "业务编号 " + knownUUIDs.business.toUpperCase(), next: "PRIVATE-SOURCE", matched: "业务已确认" } } });
    const result = exported(saved, [step("private-source", "llm", {}, { runId: knownUUIDs.run })]);
    expect(result.markdown).toContain(identity); expect(result.markdown).toContain(knownUUIDs.business.toUpperCase());
    expect(result.markdown).toContain("PRIVATE-SOURCE"); expect(result.markdown).toContain("业务已确认");
    expect(expectUnavailable(run({ result: { report: { 内容: "业务正文", nodeId: "PRIVATE-SOURCE" } } }), [step("private-source", "llm")])).toContain("内部关联");
  });

  it("同次条件UUID来源和目标只按身份等价核对，已知目标编号变体不能作为正文名称", () => {
    const recorded = { matched: "已命中", next: knownUUIDs.target.toUpperCase() };
    const saved = run({ id: knownUUIDs.run, result: { report: { ...recorded, next: mixedUUID(knownUUIDs.target) } }, outputContract: { fields: [
      { path: "report", label: "处理判断", sourceNodeId: mixedUUID(knownUUIDs.source), required: true },
    ] } });
    const source = step(knownUUIDs.source, "condition", recorded, { runId: knownUUIDs.run.toUpperCase() });
    const target = step(knownUUIDs.target, "system", {}, { runId: mixedUUID(knownUUIDs.run), nodeTitle: "实际保存的目标名称" });
    const result = exported(saved, [source, target]);
    expect(result.markdown).toContain("记录的去向：实际保存的目标名称");
    expect((result.markdown + result.csv).toLowerCase()).not.toContain(knownUUIDs.target);
    expect(expectUnavailable(saved, [source, { ...target, nodeTitle: "目标 " + mixedUUID(knownUUIDs.target) }])).toContain("内部关联");
  });

  it.each(["explicit", "legacy"] as const)("%s顶层条件next选择核对同次源值后只投影真实目标名称，非目标已完成", (style) => {
    const source = step("condition-node", "condition", { matched: "已命中", next: "private-target" });
    const target = step("private-target", "system", {}, { nodeTitle: "已保存目标名称" });
    const result = exported(selectedNextRun(style), [source, target]);
    expect(result.markdown).toContain("记录的去向：已保存目标名称");
    expect(result.markdown).toContain("不代表目标步骤已执行、流程已完成或验收通过");
    expect(result.markdown + result.csv).not.toMatch(/condition-node|private-target|matched|next/);
  });

  it.each(["explicit", "legacy"] as const)("%s顶层去向任一来源/目标缺失、错归属或值不同均停用整份", (style) => {
    const source = step("condition-node", "condition", { matched: "已命中", next: "private-target" });
    const target = step("private-target", "system", {}, { nodeTitle: "已保存目标名称" });
    for (const records of [[target], [source], [{ ...source, runId: otherRunId }, target], [source, { ...target, runId: otherRunId }],
      [{ ...source, output: { matched: "已命中", next: "other-target" } }, target], [{ ...source, output: { summary: "不能证明去向", next: "private-target" } }, target],
      [source, { ...target, nodeTitle: "private-target" }]]) {
      expect(expectUnavailable(selectedNextRun(style), records)).toContain("内部关联");
    }
    expect(expectUnavailable(selectedNextRun(style, "other-target"), [source, target])).toContain("内部关联");
    expect(expectUnavailable(selectedNextRun(style, null), [source, target])).toContain("内部关联");
    expect(expectUnavailable(selectedNextRun(style), [source, target], true)).toContain("内部关联");
  });

  it("非条件顶层next与条件嵌套业务next不冒充内部去向或全局删除", () => {
    const records = [step("condition-node", "llm", { next: "private-target" }), step("private-target", "system")];
    for (const style of ["explicit", "legacy"] as const) {
      const result = exported(selectedNextRun(style), records);
      expect(result.markdown).toContain("private-target"); expect(result.markdown).not.toContain("记录的去向：");
    }
    const saved = run({ result: { report: "下一次联系" }, outputContract: { fields: [
      { path: "report", label: "客户处理", sourceNodeId: "condition-node", sourcePath: ["客户处理", "next"], required: true },
    ] } });
    const result = exported(saved, [step("condition-node", "condition", { matched: "已命中", next: "private-target", 客户处理: { next: "下一次联系" } })]);
    expect(result.markdown).toContain("下一次联系"); expect(result.markdown).not.toContain("记录的去向：");
  });

  it("整步条件按同次保存证据投影分支与去向；保留嵌套业务next/matched，不泄内部路由", () => {
    const decision = { matched: "已命中", next: "private-target", 客户处理: { matched: "客户已确认", next: "下一次联系" } };
    const saved = run({ result: { report: decision }, outputContract: { fields: [{ path: "report", label: "处理判断", sourceNodeId: "private-source", required: true }] } });
    const result = exported(saved, [step("private-source", "condition", decision), step("private-target", "system", {}, { nodeTitle: "已保存的记录步骤" })]);
    expect(result.markdown).toContain("命中的分支：已命中"); expect(result.markdown).toContain("记录的去向：已保存的记录步骤");
    expect(result.markdown).toContain("客户已确认"); expect(result.markdown).toContain("下一次联系");
    expect(result.markdown + result.csv).not.toMatch(/private-source|private-target|matched|next/);
    expect(result.markdown).toContain("不代表后续步骤已完成或验收通过");
  });

  it.each(["missing-source", "foreign-source", "mismatched-output", "missing-target", "foreign-target", "id-as-title", "steps-unavailable"] as const)("条件%s 无法可靠核对时整份停用，不导出一半或虚拟去向", (kind) => {
    const decision = { matched: "已命中", next: "private-target" };
    const saved = run({ result: { report: decision }, outputContract: { fields: [{ path: "report", label: "判断结果", sourceNodeId: "private-source", required: true }] } });
    const source = step(); const target = step("private-target", "system", {}, { nodeTitle: "已保存的后续步骤" });
    const records = kind === "missing-source" ? [target] : kind === "missing-target" ? [source] : [
      { ...source, ...(kind === "foreign-source" ? { runId: otherRunId } : {}), ...(kind === "mismatched-output" ? { output: { matched: "另一分支", next: "private-target" } } : {}) },
      { ...target, ...(kind === "foreign-target" ? { runId: otherRunId } : {}), ...(kind === "id-as-title" ? { nodeTitle: "private-target" } : {}) },
    ];
    expect(expectUnavailable(saved, records, kind === "steps-unavailable")).toContain("内部关联");
  });

  it("空条件去向不伪称流程结束；选择业务字段不是整步条件投影", () => {
    const decision = { matched: "默认分支", next: null };
    const saved = run({ result: { report: decision }, outputContract: { fields: [{ path: "report", label: "分支记录", sourceNodeId: "private-source", required: true }] } });
    const result = exported(saved, [step("private-source", "condition", decision)]);
    expect(result.markdown).toContain("没有指定后续步骤，不据此判断流程已结束");
    const business = { matched: "业务状态", next: "下一次联系" };
    const selected = run({ result: { report: business }, outputContract: { fields: [{ path: "report", label: "客户处理", sourceNodeId: "private-source", sourcePath: ["客户处理"], required: true }] } });
    expect(exported(selected, [step()]).markdown).toContain("下一次联系");
    expect(exported(selected, [step()]).markdown).not.toContain("命中的分支：");
  });

  it.each(RunStatus.options)("真实状态 %s 只表示记录状态，不替代质量或人工验收", (status) => {
    const result = exported(run({ status }));
    expect(result.stateText).toContain("完成状态不等于通过验收");
    expect(result.stateText).not.toContain(status);
    expect(result.markdown).not.toMatch(/已按画布验收|已人工验收|正式运行已完成/);
  });

  it("自动验收来源不虚称安全试跑、没有外部执行或验收通过", () => {
    const result = exported(run({ sourceType: "evaluation" }));
    expect(result.stateText).toContain("自动验收发起");
    expect(result.stateText).toContain("不判定验收结论，不代表安全模拟或外部业务未执行");
    expect(result.stateText).not.toContain("安全试跑结果");
    expect(result.scopeText).toContain("当前页面快照"); expect(result.scopeText).toContain("不是完整的数据安全审查");
    expect(expectUnavailable({ ...run(), status: "not-a-run-status" as SavedRun["status"] })).toContain("状态");
    expect(expectUnavailable({ ...run(), sourceType: "not-a-source" as SavedRun["sourceType"] })).toContain("发起方式");
  });

  it.each(["=SUM(1,2)", "+SUM(1,2)", "-SUM(1,2)", "@SUM(1,2)", " \t\r\n=SUM(1,2)", "\u0000=SUM(1,2)", "\u007f+SUM(1,2)"])("CSV中和公式及前导控制空白 %s，固定三列不破坏引号/换行", (text) => {
    const result = exported(run({ result: { report: text } }));
    const rows = csvRows(result.csv);
    expect(result.csv.startsWith("\uFEFF")).toBe(true);
    expect(rows[1][2]).toMatch(/^'/);
    expect(rows.every((row) => row.length === 3)).toBe(true);
    expect(result.csv).toContain("\r\n");
  });

  it("CSV逗号、引号、多行与标签公式都只占一个单元格", () => {
    const saved = run({ result: { report: '正文含有,逗号和"引号"\n第二行' }, outputContract: { fields: [{ path: "report", label: "=标签", required: true }] } });
    const result = exported(saved); const rows = csvRows(result.csv);
    expect(rows).toHaveLength(2); expect(rows[1]).toHaveLength(3);
    expect(rows[1][1]).toBe("'=标签"); expect(rows[1][2]).toBe('正文含有,逗号和"引号"\n第二行');
    expect(result.csv).toContain('""引号""');
  });

  it("MD标题转义并使用长于正文的text围栏，正文活动HTML/链接只能作为文字", () => {
    const ticks = String.fromCharCode(96);
    const body = "真实正文\n" + ticks.repeat(4) + "\n<img src=https://example.test/track>\n[外链](javascript:alert(1))";
    const result = exported(run({ result: { report: body }, outputContract: { fields: [{ path: "report", label: "# 标题\n<img src=x>", required: true }] } }));
    expect(result.markdown).toContain("## \\# 标题 \\<img src=x\\>");
    expect(result.markdown).toContain(ticks.repeat(5) + "text\n" + body + "\n" + ticks.repeat(5));
  });

  it("不执行getter、不遍历循环或非JSON值；过大过深停用整份而非截半份", () => {
    const getter = vi.fn(() => "private-getter-value");
    const hostile = Object.defineProperty({}, "content", { enumerable: true, get: getter });
    const cycle: Record<string, unknown> = {}; cycle.loop = cycle;
    let deep: unknown = "深层业务"; for (let index = 0; index < 40; index += 1) deep = { 内容: deep };
    for (const value of [hostile, cycle, new Date(), { value: BigInt(1) }, { value: Infinity }, deep, "x".repeat(MAX_RUN_RESULT_BYTES + 1)]) {
      expect(expectUnavailable({ ...run(), result: value })).toContain("整份导出已停用");
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("渲染后文本超过共享字节上限也停用，不把内容层级省略提示当作业务原文", () => {
    expect(expectUnavailable(run({ result: { report: "界".repeat(MAX_RUN_RESULT_BYTES / 2) } }))).toContain("整份导出已停用");
    let deep: unknown = "private-too-deep-body"; for (let index = 0; index < 33; index += 1) deep = { 内容: deep };
    expect(expectUnavailable(run({ result: { report: deep } }))).toContain("整份导出已停用");
  });
});
