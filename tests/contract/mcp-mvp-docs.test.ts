import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HarnessPolicy } from "@/contracts/harness";
import { parseToolRegistry } from "@/server/tools/tool-registry";

describe("MCP MVP 接入文档", () => {
  const text = readFileSync("docs/mcp-mvp.md", "utf8");
  const examples = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
  it("完整登记与运行策略例子实际通过契约", () => {
    expect(examples).toHaveLength(2); expect(parseToolRegistry(JSON.stringify(examples[0]))).toHaveLength(1); expect(HarnessPolicy.safeParse(examples[1]).success).toBe(true);
  });
  it("明确真实审批、供应商配置与前端未接入的边界", () => {
    for (const required of ["本地不执行", "前端仍需", "不是 MCP 标准自动保证", "模拟持久层", "真实业务做联合验收"]) expect(text).toContain(required);
  });
});
