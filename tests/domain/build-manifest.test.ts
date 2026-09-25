// buildManifest / stableStringify 纯函数单测。draft 取 plan-golden-1 真实产物（完整草稿），
// 断言聚焦：指纹与键序无关、对内容敏感；manifest 产物过 AgentManifest 契约直接 parse（T2 Minor ②）。
// 审计摘要 status 推导（critical/warning 分支）用最小计数对象单测 deriveDesignAuditStatus，
// 不为凑 passed 分支手造全绿草稿。
import { describe, expect, it } from "vitest";
import golden1 from "../fixtures/domain/plan-golden-1.json";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft, type WorkflowDraft as WorkflowDraftType } from "@/contracts/workflow";
import { auditWorkflow, type AuditIssue } from "@/server/domain/audit";
import { buildManifest, deriveDesignAuditStatus, filterPublishBlockers, stableStringify } from "@/server/domain/pipeline";

const draft: WorkflowDraftType = WorkflowDraft.parse(golden1.output.workflow);
const options = { modelId: "test-model", mock: true, connectionId: null, knowledgeSnapshot: [] };

// 递归反转对象键序，内容不变（含默认值补全后仍然等价）
function permuteKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(permuteKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, item]) => [key, permuteKeys(item)]),
    );
  }
  return value;
}

describe("stableStringify", () => {
  it("与键序无关：键序不同、内容相同的对象序列化一致", () => {
    const a = { b: 1, a: { d: 2, c: [3, { z: 4, y: null }] } };
    const b = { a: { c: [3, { y: null, z: 4 }], d: 2 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("输出是合法 JSON 且保留数组、null 与字符串转义", () => {
    expect(JSON.parse(stableStringify({ a: [1, null, "x\"y"], u: undefined }))).toEqual({ a: [1, null, 'x"y'] });
  });
});

describe("deriveDesignAuditStatus", () => {
  it("critical>0 → blocked", () => {
    expect(deriveDesignAuditStatus({ critical: 1, warning: 2 })).toBe("blocked");
  });
  it("critical=0 且 warning>0 → passed_with_warnings", () => {
    expect(deriveDesignAuditStatus({ critical: 0, warning: 2 })).toBe("passed_with_warnings");
  });
  it("critical=0 且 warning=0 → passed", () => {
    expect(deriveDesignAuditStatus({ critical: 0, warning: 0 })).toBe("passed");
  });
});

describe("buildManifest", () => {
  it("同 draft 两次调用指纹相同", () => {
    expect(buildManifest(draft, options).workflowFingerprint).toBe(buildManifest(draft, options).workflowFingerprint);
  });

  it("键序不同、内容相同的 draft 指纹相同", () => {
    const permuted = WorkflowDraft.parse(permuteKeys(golden1.output.workflow));
    expect(buildManifest(permuted, options).workflowFingerprint).toBe(buildManifest(draft, options).workflowFingerprint);
  });

  it("字段改一个字符后指纹不同", () => {
    const title = draft.nodes.start.title;
    const changed: WorkflowDraftType = {
      ...draft,
      nodes: { ...draft.nodes, start: { ...draft.nodes.start, title: `${title}!` } },
    };
    expect(buildManifest(changed, options).workflowFingerprint).not.toBe(buildManifest(draft, options).workflowFingerprint);
  });

  it("manifest 结构：快照、草稿输入契约、模型选择", () => {
    const manifest = buildManifest(draft, options);
    expect(manifest.schemaVersion).toBe("4.0");
    expect(manifest.workflowSnapshot).toEqual(draft);
    expect(manifest.inputContract.fields).toEqual([
      expect.objectContaining({ name: "severity", label: "判断严重程度", required: true, type: "string" }),
    ]);
    expect(manifest.resourceSelection.model).toEqual({ modelId: "test-model", mock: true, connectionId: null });
    expect(manifest.outputContract).toEqual({ fields: [] });
  });

  it("草稿定义运行输入字段时按名称、类型和必填状态冻结，不再添加默认输入", () => {
    const configured = WorkflowDraft.parse({
      ...draft,
      variables: [
        { name: "brief", label: "任务说明", type: "string", scope: "run", required: true },
        { name: "count", label: "数量", type: "number", scope: "run", required: false },
      ],
    });
    expect(buildManifest(configured, options).inputContract.fields).toEqual(expect.arrayContaining([
      { name: "brief", label: "任务说明", type: "string", required: true },
      { name: "count", label: "数量", type: "number", required: false },
    ]));
    expect(buildManifest(configured, options).inputContract.fields.some((field) => field.name === "input")).toBe(false);
  });

  it("从条件和逐项处理路径推导真实运行输入类型", () => {
    const configured = WorkflowDraft.parse({
      ...draft,
      variables: [],
      nodes: {
        ...draft.nodes,
        nested_condition: {
          id: "nested_condition", title: "判断客户等级", type: "condition", next: null,
          condition: {
            source: "input.customer.level", operator: "eq",
            branches: [{ label: "重点客户", value: "vip", next: "done" }], defaultNext: "done",
          },
        },
        boolean_condition: {
          id: "boolean_condition", title: "判断是否确认", type: "condition", next: null,
          condition: {
            source: "input.approved", operator: "eq",
            branches: [{ label: "已确认", value: true, next: "done" }], defaultNext: "done",
          },
        },
        amount_condition: {
          id: "amount_condition", title: "判断金额", type: "condition", next: null,
          condition: {
            source: "input.amount", operator: "gte",
            branches: [{ label: "达到门槛", value: 100, next: "done" }], defaultNext: "done",
          },
        },
        item_loop: {
          id: "item_loop", title: "逐项处理订单", type: "loop", next: null,
          loop: { collectionPath: "input.orders", itemKey: "order", maxIterations: 20, bodyNext: "done", exitNext: "done" },
        },
        variable_condition: {
          id: "variable_condition", title: "判断地区", type: "condition", next: null,
          condition: {
            source: "variables.region", operator: "eq",
            branches: [{ label: "华东", value: "east", next: "done" }], defaultNext: "done",
          },
        },
      },
    });

    expect(buildManifest(configured, options).inputContract.fields).toEqual(expect.arrayContaining([
      { name: "customer", required: true, type: "object" },
      { name: "approved", required: true, type: "boolean" },
      { name: "amount", required: true, type: "number" },
      { name: "orders", required: true, type: "array" },
      { name: "region", required: true, type: "string" },
    ]));
    expect(buildManifest(configured, options).inputContract.fields.some((field) => field.name === "input")).toBe(false);
  });

  it("发布选定的模型连接冻结进 manifest；不传 connectionId 时为 null", () => {
    const withConnection = buildManifest(draft, {
      modelId: "gpt-a",
      mock: false,
      connectionId: "00000000-0000-4000-8000-0000000000c1",
      knowledgeSnapshot: [],
    });
    expect(withConnection.resourceSelection.model).toEqual({
      modelId: "gpt-a",
      mock: false,
      connectionId: "00000000-0000-4000-8000-0000000000c1",
    });
    expect(buildManifest(draft, options).resourceSelection.model.connectionId).toBeNull();
  });

  it("designAudit 由审计结果推导：golden 草稿有阻塞问题 → blocked，计数与审计一致", () => {
    const manifest = buildManifest(draft, options);
    const audit = auditWorkflow(draft);
    expect(audit.counts.critical).toBeGreaterThan(0);
    expect(manifest.designAudit).toEqual({
      status: "blocked",
      issueCount: audit.issues.length,
      criticalCount: audit.counts.critical,
    });
  });

  it("草稿无 coverage/complexityProfile 时对应字段缺省", () => {
    const manifest = buildManifest(draft, options);
    expect(manifest.requirementCoverage).toBeUndefined();
    expect(manifest.complexityProfile).toBeUndefined();
  });

  it("AgentManifest 契约可直接 parse buildManifest 真实产物（T2 Minor ②）", () => {
    const manifest = buildManifest(draft, options);
    expect(AgentManifest.parse(manifest)).toEqual(manifest);
  });
});

// filterPublishBlockers 用例：issues/draft 均为手造最小结构，只裁决 code 与
// nodeId 指向节点的 control 身份，与具体草稿内容解耦
function blockerIssue(code: string, nodeId: string | null, overrides: Partial<AuditIssue> = {}): AuditIssue {
  return {
    id: `issue-${code}-${nodeId ?? "root"}`,
    severity: "critical",
    category: "data",
    title: `标题-${code}`,
    detail: "细节",
    nodeId,
    fixable: true,
    code,
    ...overrides,
  };
}

const blockerDraft: WorkflowDraftType = WorkflowDraft.parse({
  id: "WF-blocker",
  rootAgent: { id: "agt_demo", name: "演示助手", role: "演示" },
  nodes: {
    ctrl: {
      id: "ctrl", title: "交付前检查结果", type: "rule", next: "finish",
      ui: { visibility: "control" }, controlPlane: { kind: "quality", hiddenByDefault: true },
    },
    biz: { id: "biz", title: "整理结果", type: "ai", next: null },
    finish: { id: "finish", title: "本次任务已完成", type: "end", next: null },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});

describe("filterPublishBlockers", () => {
  it("只豁免明确的控制节点误报，其余关键缺口全部阻止发布", () => {
    const issues = [
      blockerIssue("output_contract_missing", null),
      blockerIssue("end_without_delivery", "finish"),
      blockerIssue("meta_node_detected", "ctrl"),
      blockerIssue("business_source_unresolved", null),
      blockerIssue("dead_end", "biz"),
    ];
    const { blocking, exempted } = filterPublishBlockers(issues, blockerDraft);
    expect(exempted.map((issue) => issue.code)).toEqual(["meta_node_detected"]);
    expect(blocking.map((issue) => issue.code)).toEqual([
      "output_contract_missing", "end_without_delivery", "business_source_unresolved", "dead_end",
    ]);
  });

  it("业务节点的 meta_node_detected 不豁免；nodeId 缺失或指向未知节点也不豁免", () => {
    const { blocking, exempted } = filterPublishBlockers(
      [blockerIssue("meta_node_detected", "biz"), blockerIssue("meta_node_detected", null), blockerIssue("meta_node_detected", "ghost")],
      blockerDraft,
    );
    expect(exempted).toEqual([]);
    expect(blocking).toHaveLength(3);
  });

  it("非 critical 问题不参与裁决：不拦截发布，也不进豁免提醒", () => {
    const { blocking, exempted } = filterPublishBlockers(
      [blockerIssue("dead_end", "biz", { severity: "warning" }), blockerIssue("output_contract_missing", null, { severity: "info" })],
      blockerDraft,
    );
    expect(blocking).toEqual([]);
    expect(exempted).toEqual([]);
  });
});
