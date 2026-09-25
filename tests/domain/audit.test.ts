// 归一化说明：agt_/WF- 两条随机 id 正则同 Task 4/5/6；另加 AUDIT-<uuid36>→AUDIT-X 与
// checkedAt 时间戳归一（auditWorkflow 返回对象含随机 id/时间戳，控制方裁定 2）。issue 的
// AUD-<sha1 前 10 位> 为稳定哈希（sha1( severity|category|code|nodeId||workflow|title|detail )），
// 两侧逐字一致，不做归一。
// 裁定 1：auditWorkflow 返回完整审计结果对象（{id, score, status, counts, issues, categoryStatus,
// nodeCount, edgeCount, requirementCoverage, complexityProfile, checkedAt, schema:'design-audit/v5.7'}），
// 简报 Produces 行的 AuditIssue[] 为计划文本失真；issues 仅为其一个字段。
// fixture 链：audit-golden-1 的 input.workflow 取 grounding-golden-1.json 的 output（即
// intent-golden-1 经 groundBusinessWorkflow 产出的 grounded draft，与现场重跑等价），blueprint
// 固定 {}（auditWorkflow 默认值），旧仓库 node 运行旧 designAuditor.mjs 产出，生成模式同 Task 4/5/6。
// 直测两条期望 id（AUD-c20bf44861/AUD-6f5b9efa53）为按旧 issue 公式独立预计算的 sha1 值。
import { describe, expect, it } from "vitest";
import golden1 from "../fixtures/domain/audit-golden-1.json";
import { WorkflowDraft } from "@/contracts/workflow";
import { auditWorkflow } from "@/server/domain/audit";

function normalize(serialized: string): string {
  return serialized
    .replace(/agt_[0-9a-f]{8}/g, "agt_X")
    .replace(/WF-[0-9a-f-]+/g, "WF-X")
    .replace(/AUDIT-[0-9a-f-]{36}/g, "AUDIT-X")
    .replace(/"createdAt":"[^"]*"/g, '"createdAt":"<ISO>"')
    .replace(/"checkedAt":"[^"]*"/g, '"checkedAt":"<ISO>"');
}

const deadEndDraft = {
  id: "WF-deadend",
  rootAgent: { id: "agt_dead0001", name: "客服助手", role: "客服" },
  memoryPolicy: { taskContext: true, longTerm: false },
  startNodeId: "start",
  nodes: {
    start: { id: "start", title: "收到任务", type: "trigger", next: "work" },
    work: { id: "work", title: "整理工单摘要", type: "ai", next: null },
  },
};

const conditionDraft = {
  id: "WF-condbranch",
  rootAgent: { id: "agt_cond0001", name: "资料助手", role: "资料" },
  memoryPolicy: { taskContext: true, longTerm: false },
  startNodeId: "start",
  nodes: {
    start: { id: "start", title: "收到任务", type: "trigger", next: "check" },
    check: {
      id: "check",
      title: "判断资料完整度",
      type: "condition",
      next: null,
      condition: {
        source: "input.task",
        operator: "truthy",
        branches: [{ label: "资料完整", value: true, next: "done" }],
        defaultNext: null,
      },
    },
    done: { id: "done", title: "完成", type: "end" },
  },
};

describe("设计审计移植对齐金测", () => {
  it("audit-golden-1：同输入产出与旧系统一致（issue 稳定哈希逐字对齐）", () => {
    const out = auditWorkflow(golden1.input.workflow, golden1.input.blueprint);
    const actual = normalize(JSON.stringify(out));
    const expected = normalize(JSON.stringify(golden1.output));
    expect(actual).toEqual(expected);
  });

  it("返回对象为完整审计结果且键序与旧系统一致（裁定 1）", () => {
    const out = auditWorkflow(deadEndDraft, {});
    expect(Object.keys(out)).toEqual([
      "id",
      "score",
      "status",
      "counts",
      "issues",
      "categoryStatus",
      "nodeCount",
      "edgeCount",
      "requirementCoverage",
      "complexityProfile",
      "checkedAt",
      "schema",
    ]);
    expect(out.schema).toBe("design-audit/v5.7");
    expect(out.status).toBe("blocked");
    expect(out.nodeCount).toBe(2);
    expect(out.edgeCount).toBe(1);
  });
});

describe("直测：结构性检查", () => {
  it("ai 节点无 next 且非 end：dead_end critical，issue 全字段含稳定 id 精确断言", () => {
    const out = auditWorkflow(deadEndDraft, {});
    const deadEnds = out.issues.filter((x) => x.code === "dead_end");
    expect(deadEnds).toHaveLength(1);
    expect(deadEnds[0]).toEqual({
      id: "AUD-c20bf44861",
      severity: "critical",
      category: "flow",
      title: "流程出现死路",
      detail: "「整理工单摘要」执行后没有下一步。",
      nodeId: "work",
      fixable: true,
      code: "dead_end",
    });
  });

  it("直接比较条件缺少取值来源时阻止发布", () => {
    const result = auditWorkflow({
      startNodeId: "start",
      rootAgent: { id: "agent" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "condition" },
        condition: {
          id: "condition", title: "判断状态", type: "condition",
          condition: { source: null, branches: [{ label: "通过", value: "ok", next: "done" }], defaultNext: "done" },
        },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    });

    expect(result.issues).toContainEqual(expect.objectContaining({ code: "condition_source", severity: "critical" }));
  });

  it("未绑定执行能力的工具步骤阻止发布", () => {
    const result = auditWorkflow({
      startNodeId: "start", rootAgent: { id: "agent" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "send" },
        send: { id: "send", title: "发送通知", type: "tool", next: "done", tool: { scope: "notice.read", protocol: "unbound", unresolved: true } },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "tool_binding", severity: "critical" }));
  });

  it("condition 无 defaultNext：condition_default warning，issue 全字段含稳定 id 精确断言", () => {
    const out = auditWorkflow(conditionDraft, {});
    const defaults = out.issues.filter((x) => x.code === "condition_default");
    expect(defaults).toHaveLength(1);
    expect(defaults[0]).toEqual({
      id: "AUD-6f5b9efa53",
      severity: "warning",
      category: "logic",
      title: "条件缺少兜底路径",
      detail: "「判断资料完整度」没有“否则/未命中”路径。",
      nodeId: "check",
      fixable: true,
      code: "condition_default",
    });
  });

  it("非法名称与不受支持类型会阻止运行输入字段发布", () => {
    const out = auditWorkflow({
      ...deadEndDraft,
      variables: [
        { name: "1brief", type: "string", scope: "run" },
        { name: "payload", type: "anything", scope: "run" },
        { name: "open", type: "any", scope: "run" },
      ],
    }, {});
    expect(out.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "variable_name_invalid_1brief", severity: "critical" }),
      expect.objectContaining({ code: "variable_type_payload", severity: "critical" }),
      expect.objectContaining({ code: "variable_input_type_open", severity: "critical" }),
    ]));
  });

  it("未选择协作助手时作为发布阻塞问题", () => {
    const result = auditWorkflow(WorkflowDraft.parse({
      id: "missing-collaborator",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "call" },
        call: { id: "call", title: "请专业助手处理", type: "agent_call", next: "done", agentCall: { targetAgentId: "", versionId: "" } },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }));

    expect(result.issues).toContainEqual(expect.objectContaining({ code: "agent_call_target", severity: "critical" }));
  });

  it("交接契约不完整时作为发布阻塞问题", () => {
    const result = auditWorkflow(WorkflowDraft.parse({
      id: "incomplete-handoff",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "handoff" },
        handoff: {
          id: "handoff", title: "交给履约助手", type: "handoff", next: "done",
          toAgent: { id: "target", versionId: "version" },
          contract: { deliverables: ["处理结果"], mustNotInclude: ["密钥"], inputSchema: [], outputSchema: [] },
        },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }));

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "handoff_input_schema", severity: "critical" }),
      expect.objectContaining({ code: "handoff_output_schema", severity: "critical" }),
      expect.objectContaining({ code: "handoff_memory", severity: "critical" }),
    ]));
  });

  it("缺少执行设置的资料、经验和步骤组会阻止发布", () => {
    const result = auditWorkflow(WorkflowDraft.parse({
      id: "missing-runtime-settings",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "knowledge" },
        knowledge: { id: "knowledge", title: "读取资料", type: "knowledge", next: "memory" },
        memory: { id: "memory", title: "读取经验", type: "memory", next: "group" },
        group: { id: "group", title: "执行步骤组", type: "subflow", next: "done", subflow: { name: "", steps: [], inputs: [], outputs: [], failurePolicy: "checkpoint" } },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }));

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "knowledge_space", severity: "critical" }),
      expect.objectContaining({ code: "memory_mode", severity: "critical" }),
      expect.objectContaining({ code: "subflow_spec", severity: "critical" }),
    ]));
  });

  it("并行工作中的未绑定工具会在发布前被阻止", () => {
    const result = auditWorkflow(WorkflowDraft.parse({
      id: "parallel-runtime-settings",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "parallel" },
        parallel: {
          id: "parallel", title: "并行处理", type: "parallel", next: "done",
          parallel: {
            strategy: "all", failurePolicy: "fail_fast",
            branches: [
              { id: "one", label: "第一项", inputs: [], outputs: [], steps: [{ id: "tool", title: "调用系统", type: "tool", tool: { connector: "unknown", action: "run", scope: "record.read", risk: "low", maxRetries: 1, registryToolId: null, protocol: "unbound", unresolved: true, inputSchema: {}, outputSchema: {} } }] },
              { id: "two", label: "第二项", inputs: [], outputs: [], steps: [{ id: "ai", title: "整理结果", type: "ai" }] },
            ],
          },
        },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }));

    expect(result.issues).toContainEqual(expect.objectContaining({ code: "parallel_runtime_0_0", severity: "critical" }));
  });

  it("步骤组中的协作与经验设置不完整时会在发布前被阻止", () => {
    const result = auditWorkflow(WorkflowDraft.parse({
      id: "subflow-runtime-settings",
      rootAgent: { id: "agent", name: "测试助手", role: "处理" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "group" },
        group: {
          id: "group", title: "执行步骤组", type: "subflow", next: "done",
          subflow: {
            name: "内部处理", inputs: [], outputs: ["处理结果"], failurePolicy: "checkpoint",
            steps: [
              { id: "memory", title: "读取经验", type: "memory" },
              { id: "call", title: "请求协作", type: "agent_call", agentCall: { targetAgentId: "", versionId: "" } },
            ],
          },
        },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }));

    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "child_runtime_0", severity: "critical" }),
      expect.objectContaining({ code: "child_runtime_1", severity: "critical" }),
    ]));
  });

  it("隐藏的质量控制节点不会被误判为业务目标声明", () => {
    const out = auditWorkflow({
      ...deadEndDraft,
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "work" },
        work: { id: "work", title: "整理工单摘要", type: "ai", next: "quality_review" },
        quality_review: {
          id: "quality_review", title: "交付前检查结果", type: "rule", next: "done",
          controlPlane: { kind: "quality", hiddenByDefault: true }, ui: { visibility: "control" },
          quality: { requiredOutputTitles: [], minOutputCount: 1 },
        },
        done: { id: "done", title: "完成", type: "end" },
      },
    }, {});
    expect(out.issues.some((item) => item.code === "meta_node_detected" && item.nodeId === "quality_review")).toBe(false);
  });
});
