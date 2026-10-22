import { describe, expect, it } from "vitest";
import { outputWorkbenchWorkflowDefinition } from "../fixtures/output-workbench-workflow";
import { importedWorkflowIssue } from "@/server/domain/import-agent";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";

describe("交付工作台真实定义", () => {
  it("现有导入与发布接受整步映射，可选未执行来源不补造结果", () => {
    const definition = outputWorkbenchWorkflowDefinition("交付核对");
    expect(importedWorkflowIssue(definition.workflow)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(definition.workflow).issues, definition.workflow).blocking).toEqual([]);
    const manifest = buildManifest(definition.workflow, { modelId: "mock", mock: true, connectionId: null, knowledgeSnapshot: [] });
    expect(manifest.outputContract?.fields).toEqual(definition.workflow.outputContract!.fields);
    const decision = { matched: "文字命中", next: "text" };
    const text = { message: "真实记录" };
    const result = projectWorkflowResult({ decision, text }, manifest.outputContract!.fields);
    expect(result).toEqual({ ok: true, result: { 交付: { 核对: decision, 选中记录: text, 旧记录: decision } } });
    expect(projectWorkflowResult({ decision }, manifest.outputContract!.fields)).toEqual({ ok: false, missing: ["选中路径记录"] });
  });
});
