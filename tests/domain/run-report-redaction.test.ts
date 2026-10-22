import { describe, expect, it } from "vitest";
import { boundedJsonStorageValue, type JsonStorageRecord } from "@/contracts/json";
import { MAX_RUN_RESULT_BYTES, RunReportFile } from "@/contracts/run";
import { redactCredentialData, redactRunReportData, redactSensitiveData, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";

const ID = "00000000-0000-4000-8000-000000000111";
const HIDDEN = "[已隐藏敏感信息]";
const slots = ["input", "result", "step", "context"] as const;
type Slot = typeof slots[number];
const storedValue = boundedJsonStorageValue(MAX_RUN_RESULT_BYTES, "报告业务数据");

function wrap(value: JsonStorageRecord, layers: number): JsonStorageRecord {
  for (let index = 0; index < layers; index += 1) value = { nested: value };
  return value;
}

function reportFor(slot: Slot, value: unknown): RunReportFile {
  const report = RunReportFile.parse({
    format: "agent-studio-cloud-run", formatVersion: 1, exportedAt: "2026-10-15T00:00:00.000Z",
    run: { id: ID, agentId: ID, agentName: "成果助手", status: "completed", input: {}, result: null, error: null, startedAt: null, finishedAt: "2026-10-15T00:00:00.000Z" },
    context: { outputs: {} },
    steps: [{ nodeId: "lookup", nodeTitle: "查询业务", nodeType: "tool", status: "succeeded", attempt: 1, output: null, error: null, startedAt: null, finishedAt: null }],
    trace: [], approvals: [], feedback: null,
    integrity: { omittedSteps: 0, omittedTraceEvents: 0, omittedApprovals: 0, omittedFeedback: 0 },
  });
  if (slot === "input") report.run.input = value as JsonStorageRecord;
  else if (slot === "result") report.run.result = value;
  else if (slot === "step") report.steps[0].output = value;
  else report.context = { outputs: { lookup: value } };
  return report;
}

function payload(report: RunReportFile, slot: Slot): unknown {
  if (slot === "input") return report.run.input;
  if (slot === "result") return report.run.result;
  if (slot === "step") return report.steps[0].output;
  return (report.context!.outputs as Record<string, unknown>).lookup;
}

describe("报告封套不消耗业务成果的层级预算", () => {
  it.each(slots.flatMap((slot) => (["object", "array"] as const).map((shape) => ({ slot, shape }))))("$slot / $shape 完整保留合法32层业务值，并继续隐藏凭据及个人信息", ({ slot, shape }) => {
    const business = { amount: 0, approved: false, empty: null, tokenizer: "业务分词器", tokenUnit: 0,
      apiKey: "fixture-deep-key", contact: "finance@example.com", mobile: "13800000000", note: "Bearer fixture-secret-123456789",
      ["pat_" + "a".repeat(64)]: "不能公开的字段名" };
    const layers = shape === "object" ? 31 : 29;
    const value = wrap(shape === "object" ? business : { rows: [business] }, layers);
    expect(storedValue.safeParse(value).success).toBe(true);
    const report = reportFor(slot, value), original = JSON.stringify(report);
    expect(JSON.stringify(redactSensitiveData(report))).toContain("已省略");
    const safe = redactRunReportData(report);
    let current = payload(safe, slot) as JsonStorageRecord;
    for (let index = 0; index < layers; index += 1) current = current.nested as JsonStorageRecord;
    const expected = { amount: 0, approved: false, empty: null, tokenizer: "业务分词器", tokenUnit: 0,
      apiKey: HIDDEN, contact: HIDDEN, mobile: HIDDEN, note: HIDDEN };
    expect(current).toEqual(shape === "object" ? expected : { rows: [expected] });
    expect(JSON.stringify(safe)).not.toMatch(/已省略|fixture-deep-key|finance@example|13800000000|fixture-secret|pat_[a-f0-9]{64}/);
    expect(safe.integrity).toEqual(report.integrity);
    expect(RunReportFile.safeParse(safe).success).toBe(true);
    expect(redactRunReportData(safe)).toEqual(safe);
    expect(JSON.stringify(report)).toBe(original);
  });

  it.each(slots)("%s 的超深历史内容仍被有界处理，不放开无限遍历或暴露深层凭据", (slot) => {
    const report = reportFor(slot, wrap({ apiKey: "fixture-too-deep-key", amount: 0 }, 40));
    const original = JSON.stringify(report), safe = redactRunReportData(report);
    expect(JSON.stringify(safe)).toContain("内容层级过深，已省略");
    expect(JSON.stringify(safe)).not.toContain("fixture-too-deep-key");
    expect(JSON.stringify(report)).toBe(original);
  });

  it.each([0, false, null, "", []].map((value) => ({ value })))("最终成果 $value 不被真假值判断或封套处理替换", ({ value }) => {
    expect(redactRunReportData(reportFor("result", value)).run.result).toEqual(value);
  });

  it("保留完整两兆业务正文，不以报告封套、字节裁剪或虚构遗漏替代成果", () => {
    const value = { amount: 0, approved: false, text: "" };
    value.text = "x".repeat(MAX_RUN_RESULT_BYTES - new TextEncoder().encode(JSON.stringify(value)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBe(MAX_RUN_RESULT_BYTES);
    expect(storedValue.safeParse(value).success).toBe(true);
    const report = reportFor("result", value), safe = redactRunReportData(report);
    expect(safe.run.result).toEqual(value);
    expect(safe.integrity).toEqual(report.integrity);
  });

  it("浅层报告说明、轨迹及敏感字段仍采用原个人信息和凭据规则", () => {
    const report = reportFor("result", { amount: 0 });
    report.run.agentName = "联系 finance@example.com";
    report.trace = [{ id: ID, seq: 1, nodeId: null, kind: "run.completed", level: "info", title: "已完成", detail: "Bearer fixture-trace-secret-123456", at: "2026-10-15T00:00:00.000Z" }];
    expect(redactRunReportData(report)).toEqual(redactSensitiveData(report));
    expect(JSON.stringify(redactRunReportData(report))).not.toMatch(/finance@example|fixture-trace-secret/);
  });

  it("不改变普通上下文12层与结构化凭据32层的原限制或个人信息范围", () => {
    const value = wrap({ amount: 0, contact: "finance@example.com", apiKey: "fixture-key" }, 20);
    expect(JSON.stringify(redactSensitiveData(value))).toContain("已省略");
    expect(JSON.stringify(redactCredentialData(value))).toContain("已省略");
    expect(JSON.stringify(redactStructuredCredentialData(value))).toContain("finance@example.com");
    expect(JSON.stringify(redactStructuredCredentialData(wrap({ amount: 0 }, 34)))).toContain("已省略");
  });
});
