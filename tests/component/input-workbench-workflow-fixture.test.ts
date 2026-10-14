import { describe, expect, it } from "vitest";
import { inputWorkbenchWorkflowDefinition } from "../fixtures/input-workbench-workflow";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { importedWorkflowIssue } from "@/server/domain/import-agent";

describe("输入工作台真实导入定义", () => {
  it("五种输入通过现有发布检查，旧范围只保留定义而不进入实际输入契约", () => {
    const definition = inputWorkbenchWorkflowDefinition("输入定义核对");
    expect(importedWorkflowIssue(definition.workflow)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(definition.workflow).issues, definition.workflow).blocking).toEqual([]);
    const manifest = buildManifest(definition.workflow, { modelId: "mock", mock: true, connectionId: null, knowledgeSnapshot: [] });
    expect(manifest.inputContract.fields.map((field) => field.type)).toEqual(["object", "number", "boolean", "array", "string", "string"]);
    expect(manifest.inputContract.fields.some((field) => field.name === "legacy_note")).toBe(false);
    expect(definition.workflow.variables.find((field) => field.name === "legacy_note")!.scope).toBe("private");
    expect(manifest.inputContract.fields.some((field) => Object.hasOwn(field, "description"))).toBe(false);
  });
});
