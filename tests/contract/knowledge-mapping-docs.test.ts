import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { resolveKnowledgeQuery } from "@/server/domain/runtime/knowledge-query";

describe("知识检索映射文档", () => {
  it("完整示例通过共享契约，实际只检索明确业务主题", () => {
    const document = readFileSync(new URL("../../docs/node-input-mapping.md", import.meta.url), "utf8");
    const section = document.split("## 知识检索字段映射")[1]?.split(/\n## /)[0];
    expect(section).toBeTruthy();
    const examples = [...section!.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
    expect(examples).toHaveLength(2);
    const node = WorkflowNode.parse(examples[0]);
    expect(resolveKnowledgeQuery({ node, ...examples[1] })).toEqual({ ok: true, query: "退货政策" });
    expect(resolveKnowledgeQuery({ node, input: examples[1].input, outputs: {} }).ok).toBe(false);
    expect(resolveKnowledgeQuery({ node, input: examples[1].input, outputs: { extract: { topic: null }, other: { topic: "不能替代" } } }).ok).toBe(false);
  });
});
