import { describe, expect, it } from "vitest";
import { nestedMemoryWorkflowDefinition } from "../fixtures/nested-memory-workflow";
import { auditWorkflow } from "@/server/domain/audit";
import { filterPublishBlockers } from "@/server/domain/pipeline";
import { importedWorkflowIssue } from "@/server/domain/import-agent";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

describe("桌面组内经验验收定义", () => {
  it("沿用现有编译管道，可导入发布且经验步骤有真实限定运行标识", () => {
    const { definition, marker } = nestedMemoryWorkflowDefinition("经验核对123");
    expect(marker).not.toMatch(/\d/);
    expect(redactSensitiveText(marker)).toBe(marker);
    expect(importedWorkflowIssue(definition.workflow)).toBeNull();
    expect(filterPublishBlockers(auditWorkflow(definition.workflow).issues, definition.workflow).blocking).toEqual([]);
    const subflow = prepareSubflow(definition.workflow.nodes.group);
    const parallel = prepareParallelBranches(definition.workflow.nodes.parallel);
    expect(subflow.ok).toBe(true);
    expect(parallel.ok).toBe(true);
    if (!subflow.ok || !parallel.ok) throw new Error("组内定义不完整");
    expect(subflow.steps.map((step) => step.id)).toEqual(["group.prepare", "group.read", "group.write"]);
    expect(parallel.branches[0].steps.map((step) => step.id)).toEqual(["parallel.materials.prepare", "parallel.materials.write", "parallel.materials.read"]);
    expect(subflow.steps[0].description).toBe(marker + "group");
    expect(parallel.branches[0].steps[0].description).toBe(marker + "parallel");
    expect(parallel.branches[0].steps[1].memory).toEqual({ mode: "write", contentFrom: "run_summary" });
  });
});
