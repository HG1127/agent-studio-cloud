import { describe, expect, it } from "vitest";
import { conditionWorkflowDefinition } from "../fixtures/condition-workflow";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { auditWorkflow } from "@/server/domain/audit";
import { importedWorkflowIssue } from "@/server/domain/import-agent";

describe("条件桌面验收的真实导入定义", () => {
  it("由现有管道生成、通过导入和发布检查，运行输入是真实对象契约", () => {
    const definition = conditionWorkflowDefinition("条件路径核对");
    expect(importedWorkflowIssue(definition.workflow)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(definition.workflow).issues, definition.workflow).blocking).toEqual([]);
    const manifest = buildManifest(definition.workflow, { modelId: "mock", mock: true, connectionId: null, knowledgeSnapshot: [] });
    expect(manifest.inputContract.fields.find((field) => field.name === "payload")?.type).toBe("object");
    expect(Object.values(definition.workflow.nodes).filter((node) => node.type === "condition")).toHaveLength(1);
  });
});
