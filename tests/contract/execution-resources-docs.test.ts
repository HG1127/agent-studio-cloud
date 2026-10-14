import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExecutionPolicyHistoryResult, ExecutionPolicyInput, ExecutionPolicyReadResult, ExecutionPolicyWriteResult } from "@/contracts/execution-resources";
import { RunTaskStartResult } from "@/contracts/run-task";
describe("执行资源协议文档", () => {
  it("完整 JSON 示例逐个通过实际前后端共享契约", () => {
    const document = readFileSync(new URL("../../docs/execution-resources-http-contract.md", import.meta.url), "utf8");
    const examples = [...document.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
    const schemas = [ExecutionPolicyReadResult, ExecutionPolicyInput, ExecutionPolicyWriteResult, ExecutionPolicyHistoryResult, RunTaskStartResult];
    expect(examples).toHaveLength(schemas.length); examples.forEach((example, index) => { expect(schemas[index].safeParse(example).success, `完整示例 ${index + 1}`).toBe(true); });
  });
});
