import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { workflowCollaborations } from "@/features/workflow-canvas/workflow-collaborations";
import { collaborationAgentId, collaborationCall, collaborationDraft, collaborationHandoff, collaborationTarget } from "../fixtures/workflow-collaborations";

const collect = (draft = collaborationDraft, targets = [collaborationTarget]) => workflowCollaborations(draft, targets, collaborationAgentId);

describe("当前草稿协作清单", () => {
  it("按真实路径收集顶层和步骤组，显示绑定自己的冻结字段，不换成登记项当前字段", () => {
    const rows = collect();
    expect(rows.map((row) => row.title)).toEqual(["核对客户背景", "交付给研究助手", "组内交接"]);
    expect(rows[0]).toMatchObject({ targetName: "原研究助手", versionLabel: "固定版本 3", targetHref: `/agents/${collaborationTarget.agentId}`, inputLabels: ["冻结的任务说明"], outputLabels: ["冻结的研究结果"], issues: [] });
    expect(rows[2]).toMatchObject({ ownerNodeId: "group", location: "交付准备 · 第 1 步", memoryLabel: "不传递上游经验步骤结果" });
  });
  it("原版本未显示仍保留绑定名和未知状态，不自动换成同助手新版本", () => {
    const rows = collect(collaborationDraft, [{ ...collaborationTarget, versionId: "00000000-0000-4000-8000-000000000064", version: 4 }]);
    expect(rows[0]).toMatchObject({ targetName: "原研究助手", versionLabel: "已固定版本，当前清单未显示", targetHref: null });
    expect(rows[0].issues.join()).toContain("不等于版本已失效");
    expect(collaborationDraft.nodes.call.agentCall?.versionId).toBe(collaborationTarget.versionId);
  });
  it("匹配必须同时满足助手和版本，不能只凭版本号给错误助手跳转", () => {
    expect(collect(collaborationDraft, [{ ...collaborationTarget, agentId: "00000000-0000-4000-8000-000000000065" }])[0].targetHref).toBeNull();
  });
  it("并行分支里重复的内部步骤编号仍分别保留并定位所属画布步骤", () => {
    const parallel = WorkflowNode.parse({ id: "parallel", title: "同时准备", type: "parallel", next: "done", parallel: { strategy: "all", failurePolicy: "continue", branches: [
      { id: "a", label: "核对信息", steps: [{ ...collaborationCall, id: "same" }] }, { id: "b", label: "准备交付", steps: [{ ...collaborationHandoff, id: "same" }] },
    ] } });
    const draft = WorkflowDraft.parse({ ...collaborationDraft, nodes: { start: { ...collaborationDraft.nodes.start, next: "parallel" }, parallel, done: collaborationDraft.nodes.done } });
    const rows = collect(draft);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(rows.map((row) => row.ownerNodeId)).toEqual(["parallel", "parallel"]);
    expect(rows[1].location).toContain("准备交付");
  });
  it("坏的内嵌约定保留在清单里并显示不可读，不把它删掉或声称不传递经验", () => {
    const draft = WorkflowDraft.parse({ ...collaborationDraft, nodes: { ...collaborationDraft.nodes, group: { ...collaborationDraft.nodes.group, subflow: { ...collaborationDraft.nodes.group.subflow!, steps: [{ ...collaborationHandoff, contract: { deliverables: "bad" } }] } } } });
    const row = collect(draft)[2];
    expect(row.node).toBeNull();
    expect(row.inputLabels).toBeNull();
    expect(row.memoryLabel).toBe("经验范围暂不可读");
    expect(row.issues.join()).toContain("格式不完整");
    expect(draft.nodes.group.subflow?.steps[0].contract).toEqual({ deliverables: "bad" });
  });
  it("未连接、未绑定与交接缺项各自可见，不把设置存在判为可运行", () => {
    const draft = WorkflowDraft.parse({ ...collaborationDraft, nodes: { ...collaborationDraft.nodes, orphan: { id: "orphan", title: "独立交接", type: "handoff", toAgent: { id: "", versionId: "" } } } });
    const row = collect(draft).at(-1)!;
    expect(row.issues).toHaveLength(3);
    expect(row.targetName).toBe("尚未选择助手");
    expect(row.targetHref).toBeNull();
  });
  it("自身调用、未记录字段名称与旧共享名称均不虚标能力", () => {
    const draft = WorkflowDraft.parse({ ...collaborationDraft, nodes: { ...collaborationDraft.nodes,
      call: { ...collaborationCall, agentCall: { ...collaborationCall.agentCall!, targetAgentId: collaborationAgentId, inputContract: { fields: [{ name: "brief" }] }, outputContract: { fields: [{ path: "summary" }] } } },
      handoff: { ...collaborationHandoff, contract: { ...collaborationHandoff.contract!, memoryPolicy: { mode: "team", shared: ["业务进度"], private: [] } } },
    } });
    const rows = collect(draft);
    expect(rows[0].issues.join()).toContain("当前助手自身");
    expect(rows[0].inputLabels).toEqual(["传入内容 1"]);
    expect(rows[0].outputLabels).toEqual(["返回内容 1"]);
    expect(rows[1].memoryLabel).toBe("允许传递上游经验步骤结果");
    expect(rows[1].issues.join()).toContain("不是当前执行的经验白名单");
  });
});
