// buildManifest / stableStringify 纯函数单测。draft 取 plan-golden-1 真实产物（完整草稿），
// 断言聚焦：指纹与键序无关、对内容敏感；manifest 产物过 AgentManifest 契约直接 parse（T2 Minor ②）。
// 审计摘要 status 推导（critical/warning 分支）用最小计数对象单测 deriveDesignAuditStatus，
// 不为凑 passed 分支手造全绿草稿。
import { describe, expect, it } from "vitest";
import golden1 from "../fixtures/domain/plan-golden-1.json";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft, type WorkflowDraft as WorkflowDraftType } from "@/contracts/workflow";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, deriveDesignAuditStatus, stableStringify } from "@/server/domain/pipeline";

const draft: WorkflowDraftType = WorkflowDraft.parse(golden1.output.workflow);
const options = { modelId: "test-model", mock: true };

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

  it("manifest 结构：快照、输入契约（统一业务输入 + condition 的 input.* 字段）、模型选择", () => {
    const manifest = buildManifest(draft, options);
    expect(manifest.schemaVersion).toBe("4.0");
    expect(manifest.workflowSnapshot).toEqual(draft);
    expect(manifest.inputContract.fields[0]).toMatchObject({ name: "input", label: "业务输入", required: true });
    // plan-golden-1 的条件节点引用 input.severity → 列出 severity 字段
    expect(manifest.inputContract.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "severity", required: true })]),
    );
    expect(manifest.resourceSelection.model).toEqual({ modelId: "test-model", mock: true });
    expect(manifest.outputContract).toEqual({ fields: [] });
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
