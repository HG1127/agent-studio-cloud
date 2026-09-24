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
});
