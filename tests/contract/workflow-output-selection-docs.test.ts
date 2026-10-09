import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";

const docs = readFileSync(new URL("../../docs/workflow-output-selection.md", import.meta.url), "utf8");
const examples = [...docs.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
describe("最终交付字段完整文档", () => {
  it("完整示例经实际契约和领域实现产生零值及否定值成果", () => {
    expect(examples).toHaveLength(3);
    const contract = WorkflowDraft.shape.outputContract.parse(examples[0]);
    expect(projectWorkflowResult(examples[1], contract!.fields)).toEqual({ ok: true, result: examples[2] });
  });
  it("明确旧兼容、冻结来源与当前无专用编辑器", () => {
    for (const term of ["冻结版本", "省略", "旧字段", "安全修复", "尚无专用来源字段编辑器"]) {
      const text = term === "尚无专用来源字段编辑器" ? readFileSync(new URL("../../README.md", import.meta.url), "utf8") : docs;
      expect(text).toContain(term);
    }
  });
  it("明确容量、数组、凭据及非真实业务验收边界", () => {
    for (const term of ["2MB", "32", "50000", "100", "getter", "toJSON", "password", "apiKey", "不支持", "不能替代", "共享或生产库"]) expect(docs).toContain(term);
  });
  it("编排只传冻结配置，最终计算在收尾步骤调用领域函数", () => {
    const workflow = readFileSync(new URL("../../src/server/workflows/agent-run.ts", import.meta.url), "utf8");
    const steps = readFileSync(new URL("../../src/server/steps/run-state.ts", import.meta.url), "utf8");
    expect(workflow).not.toContain("projectWorkflowResult");
    expect(workflow).toContain("await finalizeWorkflowResult");
    expect(steps).toContain("export async function finalizeWorkflowResult");
    expect(steps).toContain("projectWorkflowResult(args.outputs, args.fields, args.inlineReferences)");
  });
});
