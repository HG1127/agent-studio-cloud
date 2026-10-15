import { describe, expect, it } from "vitest";
import { WorkflowNode, WorkflowOutputField } from "@/contracts/workflow";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { isToolSchemaSafeToExpose } from "@/server/domain/tool-schema-visibility";
import { isCredentialFieldName, redactCredentialData, redactSensitiveData, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";
import { projectWorkflowResult, validateOutputContract } from "@/server/domain/runtime/output-contract";
import { classifyDefaultResultFrame, freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";

const businessFields = [
  { name: "tokenizer", value: "algorithm-a" }, { name: "tokenizationMode", value: "words" },
  { name: "tokenize", value: false }, { name: "tokenizing", value: false },
  { name: "modelTokenizerName", value: "algorithm-b" }, { name: "tokenizer_name", value: "algorithm-c" },
  { name: "tokenUnit", value: "characters" }, { name: "token_units", value: "pieces" },
  { name: "tokenUsage", value: 0 }, { name: "token_count", value: 0 }, { name: "tokenCounts", value: 0 },
  { name: "tokenLimit", value: 0 }, { name: "token_limits", value: 0 },
  { name: "tokenBudget", value: 0 }, { name: "token_budgets", value: 0 },
  { name: "inputTokens", value: 0 }, { name: "output_tokens", value: 0 }, { name: "totalTokens", value: 0 },
  { name: "promptTokens", value: 0 }, { name: "completion_tokens", value: 0 },
];
const credentialFields = ["token", "accessToken", "refresh_token", "tokenizerApiKey", "tokenizationSecret", "tokenizeCredential",
  "tokenizingPassword", "tokenUnitCredential", "tokenUsageSecret", "tokenCountToken", "tokenBudgetAuthorization", "tokenizerSessionId"];
const RUN = "123e4567-e89b-42d3-a456-426614174000", FINISHED = "2026-10-15T10:00:00.000Z";
const registration = { id: "lookup", name: "模型资料", action: "lookup", scope: "model.read", protocol: "mcp-streamable-http", operationKind: "read", risk: "low", endpoint: "https://fixture.example/mcp", inputSchema: { type: "object" } };
const node = WorkflowNode.parse({ id: "lookup", title: "读取模型资料", type: "tool", tool: {
  connector: "资料服务", registryToolId: "lookup", action: "lookup", scope: "model.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read",
} });
const selected = (name: string) => WorkflowOutputField.parse({ path: name, label: "业务成果", required: true, sourceNodeId: "lookup", sourcePath: [name] });
const freeze = (result: Record<string, unknown>) => freezeDefaultResultFrame({ runId: RUN, status: "completed", outcome: "completed", finishedAt: FINISHED, result });

describe("目录字段到最终成果的共享凭据判定", () => {
  it.each(businessFields)("业务字段 $name 从真实登记到选择、冻结和结果查询投影一致保留", ({ name, value }) => {
    const payload = { [name]: value }, before = JSON.stringify(payload);
    const outputSchema = { type: "object", properties: { [name]: { type: typeof value, default: value } } };
    expect(isCredentialFieldName(name)).toBe(false);
    expect(parseToolRegistry(JSON.stringify([{ ...registration, outputSchema }]))[0]?.outputSchema).toEqual(outputSchema);
    expect(redactCredentialData(payload)).toEqual(payload);
    expect(redactStructuredCredentialData(payload)).toEqual(payload);
    expect(redactSensitiveData(payload)).toEqual(payload);
    const fields = [selected(name)];
    expect(validateOutputContract(fields, { lookup: node })).toBeNull();
    const projected = projectWorkflowResult({ lookup: payload }, fields);
    expect(projected).toEqual({ ok: true, result: payload });
    if (!projected.ok) throw new Error("纯链路没有交付所选字段");
    const frozen = freeze(projected.result);
    expect(frozen.frame.result).toEqual(payload);
    expect(classifyDefaultResultFrame(frozen, frozen.frame)).toBe("match");
    expect(presentRunTaskResult({ runId: RUN, status: "completed", result: frozen.frame.result, error: null, outputContract: { fields } }).result).toEqual(payload);
    expect(JSON.stringify(payload)).toBe(before);
  });

  it.each(credentialFields)("复合或独立凭据字段 %s 仍不可公开、选取或冻结", (name) => {
    const payload = { [name]: "opaque-fixture-value" }, before = JSON.stringify(payload);
    expect(isCredentialFieldName(name)).toBe(true);
    for (const redact of [redactCredentialData, redactStructuredCredentialData, redactSensitiveData]) {
      expect(redact(payload)).toEqual({ [name]: "[已隐藏敏感信息]" });
    }
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { [name]: { type: "string", default: payload[name] } } })).toBe(false);
    expect(validateOutputContract([selected(name)], { lookup: node })).toContain("不能选择凭据");
    expect(() => freeze(payload)).toThrow("凭据");
    expect(JSON.stringify(payload)).toBe(before);
  });

  it.each(businessFields)("允许 $name 的名字不放行其文字中的真实凭据标记", ({ name }) => {
    const payload = { [name]: "Bearer fixture-credential-123456" };
    expect(redactStructuredCredentialData(payload)).toEqual({ [name]: "[已隐藏敏感信息]" });
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { [name]: { type: "string", default: payload[name] } } })).toBe(false);
    expect(() => freeze(payload)).toThrow("凭据");
  });

  it.each(["tokenizerEmail", "tokenizationPhone", "tokenizerAddress"])("字段 %s 的个人信息仍按上下文策略隐藏", (name) => {
    const payload = { [name]: "business-contact" };
    expect(redactSensitiveData(payload)).toEqual({ [name]: "[已隐藏敏感信息]" });
    expect(redactStructuredCredentialData(payload)).toEqual(payload);
  });

  it("分词业务对象里的嵌套凭据仍隐藏，不改变源数据和普通上下文层级边界", () => {
    let payload: Record<string, unknown> = { tokenizer: { name: "algorithm-a", apiKey: "opaque-fixture-value" }, tokenUnit: "characters", amount: 0, active: false };
    for (let index = 0; index < 20; index++) payload = { child: payload };
    const before = JSON.stringify(payload), safe = redactStructuredCredentialData(payload);
    let current = safe as Record<string, unknown>;
    for (let index = 0; index < 20; index++) current = current.child as Record<string, unknown>;
    expect(current).toEqual({ tokenizer: { name: "algorithm-a", apiKey: "[已隐藏敏感信息]" }, tokenUnit: "characters", amount: 0, active: false });
    expect(JSON.stringify(redactCredentialData(payload))).toContain("已省略");
    expect(JSON.stringify(payload)).toBe(before);
    expect(() => freeze(payload)).toThrow("凭据");
  });
});
