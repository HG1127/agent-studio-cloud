import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { draftRecoveryKey, draftsEquivalent, readDraftRecoveryCopy, restoreDraftRecovery, serializeDraftRecovery } from "@/features/workflow-canvas/draft-recovery";

const saved = WorkflowDraft.parse({
  id: "workflow-recovery",
  rootAgent: { id: "agent-recovery", name: "恢复助手", role: "业务助手" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "结束", type: "end", next: null },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});

describe("流程草稿标签页恢复", () => {
  it("服务端草稿未变化时恢复经过契约校验的本地修改", () => {
    const local = WorkflowDraft.parse({
      ...saved,
      nodes: { ...saved.nodes, done: { ...saved.nodes.done, title: "完成交付" } },
    });
    expect(restoreDraftRecovery(serializeDraftRecovery(saved, local), saved)).toEqual(local);
    expect(draftRecoveryKey("agent-1")).toBe("agent-studio:workflow-draft:agent-1");
  });

  it("服务端草稿变化后不恢复陈旧副本", () => {
    const local = WorkflowDraft.parse({ ...saved, rootAgent: { ...saved.rootAgent, name: "本地名称" } });
    const changedOnServer = WorkflowDraft.parse({
      ...saved,
      nodes: { ...saved.nodes, done: { ...saved.nodes.done, title: "服务端新标题" } },
    });
    const raw = serializeDraftRecovery(saved, local);
    expect(restoreDraftRecovery(raw, changedOnServer)).toBeNull();
    expect(readDraftRecoveryCopy(raw)).toEqual(local);
  });

  it("只修改助手名称不会丢弃画布中的本地修改", () => {
    const local = WorkflowDraft.parse({
      ...saved,
      nodes: { ...saved.nodes, done: { ...saved.nodes.done, title: "完成本地交付" } },
    });
    const renamedOnServer = WorkflowDraft.parse({
      ...saved,
      rootAgent: { ...saved.rootAgent, name: "新的助手名称" },
    });
    expect(restoreDraftRecovery(serializeDraftRecovery(saved, local), renamedOnServer)).toEqual(local);
    expect(draftsEquivalent(saved, renamedOnServer)).toBe(true);
  });

  it("提交成功但响应丢失时，刷新后仍恢复随后编辑的内容", () => {
    const submitted = WorkflowDraft.parse({
      ...saved,
      nodes: { ...saved.nodes, done: { ...saved.nodes.done, title: "已提交的结束步骤" } },
    });
    const local = WorkflowDraft.parse({
      ...submitted,
      variables: [{ name: "brief", label: "业务说明", type: "string", scope: "run", required: true }],
    });
    const raw = serializeDraftRecovery(saved, local, submitted);
    expect(restoreDraftRecovery(raw, saved)).toEqual(local);
    expect(restoreDraftRecovery(raw, submitted)).toEqual(local);
    const unrelated = WorkflowDraft.parse({ ...saved, nodes: { ...saved.nodes, done: { ...saved.nodes.done, title: "其他人保存的标题" } } });
    expect(restoreDraftRecovery(raw, unrelated)).toBeNull();
  });

  it("忽略损坏或不符合流程契约的恢复内容", () => {
    expect(restoreDraftRecovery("not-json", saved)).toBeNull();
    const raw = serializeDraftRecovery(saved, saved);
    const record = JSON.parse(raw) as Record<string, unknown>;
    record.draft = { id: "broken" };
    expect(restoreDraftRecovery(JSON.stringify(record), saved)).toBeNull();
    expect(readDraftRecoveryCopy(JSON.stringify(record))).toEqual({ id: "broken" });
  });
});
