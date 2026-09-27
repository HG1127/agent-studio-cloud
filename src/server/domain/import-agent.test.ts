import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { importRequestMatches } from "@/server/domain/import-agent";

const id = "00000000-0000-4000-8000-0000000000d1";
const workflow = WorkflowDraft.parse({
  id: "workflow-import-retry",
  rootAgent: { id, name: "导入助手", role: "业务助手" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "结束", type: "end", next: null },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});
const imported = {
  name: "导入助手",
  description: "导入描述",
  intentText: "导入意图",
  workflow,
};

describe("导入请求幂等判断", () => {
  it("没有导入指纹时只复用内容相同的历史流程", () => {
    const existing = { id, ...imported, draft: workflow, importFingerprint: null };
    expect(importRequestMatches(existing, imported, "fingerprint")).toBe(true);
    const changed = {
      ...imported,
      workflow: WorkflowDraft.parse({ ...workflow, memoryPolicy: { taskContext: true, longTerm: true } }),
    };
    expect(importRequestMatches(existing, changed, "fingerprint")).toBe(false);
  });

  it("已保存导入指纹时严格按原请求内容识别", () => {
    const existing = { id, ...imported, draft: workflow, importFingerprint: "original" };
    expect(importRequestMatches(existing, imported, "original")).toBe(true);
    expect(importRequestMatches(existing, imported, "changed")).toBe(false);
    expect(importRequestMatches({ ...existing, name: "其他助手" }, imported, "original")).toBe(false);
  });
});
