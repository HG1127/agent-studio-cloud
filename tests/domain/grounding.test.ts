// 归一化说明：agt_/WF- 两条随机 id 正则同 Task 4/5；createdAt 归一为两侧同值——输出经
// structuredClone 透传了 requirementContract.createdAt，占位替换用于两侧对齐，并防 fixture
// 重生成时时间戳漂移。
// fixture 链：grounding-golden-1 的 input.workflow 取自 intent-golden-1.json 的 output.workflow，
// sourceText 取 intent-golden-1 的 input.text，answers 固定为 {}（旧仓库 node --input-type=module
// 直接运行旧 businessGroundingV57.mjs 产出，生成命令同 Task 4/5 模式）。
// 裁定 1：forbiddenActionMatch 签名以旧代码为准——(node, directives) 且返回匹配对象
// {matched, directive, actionFamilies, objectFamilies, nodeText}，简报 Produces 行的
// (text, forbidden): boolean 为计划文本失真。
// 裁定 2：runtimeBusinessPolicyDecision 为简报 Produces 清单遗漏项，按控制方裁定一并移植导出。
import { describe, expect, it } from "vitest";
import golden1 from "../fixtures/domain/grounding-golden-1.json";
import { WorkflowDraft } from "@/contracts/workflow";
import {
  businessExecutabilityAmbiguities,
  businessVisibleNodes,
  extractBusinessRequirements,
  forbiddenActionMatch,
  groundBusinessWorkflow,
  normalizeForbiddenActions,
  runtimeBusinessPolicyDecision,
} from "@/server/domain/grounding";
import { splitForbiddenDirectives } from "@/server/domain/grounding/business-policy";

function normalize(serialized: string): string {
  return serialized
    .replace(/agt_[0-9a-f]{8}/g, "agt_X")
    .replace(/WF-[0-9a-f-]+/g, "WF-X")
    .replace(/"createdAt":"[^"]*"/g, '"createdAt":"<ISO>"');
}

const goldOptions = { sourceText: golden1.input.sourceText, answers: golden1.input.answers } as const;

describe("业务落地门禁移植对齐金测", () => {
  it("grounding-golden-1：同输入产出与旧系统一致，coveragePercent 与 fixture 一致", () => {
    const out = groundBusinessWorkflow(golden1.input.workflow, goldOptions);
    expect(() => WorkflowDraft.parse(out)).not.toThrow();
    const actual = normalize(JSON.stringify(out));
    const expected = normalize(JSON.stringify(golden1.output));
    expect(actual).toEqual(expected);
    expect(out.businessGrounding?.coveragePercent).toBe(golden1.output.businessGrounding.coveragePercent);
  });

  it("控制面节点（quality_review/safe_stop/not_approved/verify_*）ui.visibility === 'control'", () => {
    const out = groundBusinessWorkflow(golden1.input.workflow, goldOptions);
    for (const [id, node] of Object.entries(out.nodes)) {
      if (/^(quality_review|safe_stop|not_approved|verify_)/.test(id)) {
        expect(node.ui?.visibility, `${id} 应为控制面`).toBe("control");
      }
    }
    expect(out.nodes.not_approved.controlPlane?.kind).toBe("safety");
    expect(out.nodes.quality_review.controlPlane?.kind).toBe("quality");
    expect(out.nodes.quality_review.controlPlane?.hiddenByDefault).toBe(true);

    // 合成输入补齐契约必填字段（id/rootAgent/memoryPolicy），使实现内 validate-only parse 不抛
    const synthetic = groundBusinessWorkflow({
      id: "WF-synthetic",
      rootAgent: { id: "agt_00000000", name: "助手", role: "助手" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "verify_reply" },
        verify_reply: { id: "verify_reply", title: "核验工具回执", type: "rule", rule: { kind: "tool_receipt" }, next: "safe_stop" },
        safe_stop: { id: "safe_stop", title: "未获确认先停止", type: "system", next: "done" },
        done: { id: "done", title: "结束", type: "end" },
      },
    });
    expect(synthetic.nodes.verify_reply.ui?.visibility).toBe("control");
    expect(synthetic.nodes.verify_reply.controlPlane?.kind).toBe("receipt");
    expect(synthetic.nodes.safe_stop.ui?.visibility).toBe("control");
    expect(synthetic.nodes.safe_stop.controlPlane?.kind).toBe("safety");
  });

  it("businessVisibleNodes 排除控制面节点；businessExecutabilityAmbiguities 暴露数据源缺口", () => {
    const out = groundBusinessWorkflow(golden1.input.workflow, goldOptions);
    const visible = businessVisibleNodes(out);
    expect(visible.map((n) => n.id).sort()).toEqual(["done", "start", "step_1", "step_2", "step_3", "step_4", "step_5"]);
    const ambiguities = businessExecutabilityAmbiguities(out);
    expect(ambiguities.length).toBeGreaterThan(0);
    expect(ambiguities[0]).toMatchObject({ id: "data_source_step_1", question: "“读取客户资料”应该从哪个知识库、文档集或资料源读取？" });
  });
});

describe("需求抽取与禁止动作归一化", () => {
  it("extractBusinessRequirements 对「不要给客户发促销邮件」产出 type:'constraint' 条目", () => {
    const rows = extractBusinessRequirements({
      sourceText: "收到客户咨询后读取客户资料并整理问题要点，生成回复方案。不要给客户发促销邮件。",
    });
    const constraint = rows.find((r) => r.type === "constraint");
    expect(constraint?.text).toBe("不要给客户发促销邮件");
    expect(constraint).toMatchObject({ source: "user", explicit: true, confidence: 1 });
  });

  it("normalizeForbiddenActions 捕获「发促销邮件」，保留否定前缀与顿号继承", () => {
    const normalized = normalizeForbiddenActions(["不要给客户发促销邮件"]);
    expect(normalized).toEqual(["不要给客户发促销邮件"]);
    expect(normalized[0]).toContain("发促销邮件");
    expect(splitForbiddenDirectives("不要发促销邮件、群发短信")).toEqual(["不要发促销邮件", "不要群发短信"]);
  });
});

describe("运行时业务策略门禁（Task 11 rule 节点消费面）", () => {
  const wf = { businessPolicies: { forbiddenActions: ["不要给客户发促销邮件"] }, nodes: {} };

  it("forbiddenActionMatch 按 node+directives 签名返回匹配对象（裁定 1）", () => {
    const match = forbiddenActionMatch({ id: "n1", title: "发送促销邮件", type: "ai" }, ["不要给客户发促销邮件"]);
    expect(match.matched).toBe(true);
    expect(match.directive).toBe("不要给客户发促销邮件");
    expect(match.actionFamilies).toEqual(["send"]);
    expect(match.objectFamilies).toEqual(["mail"]);
    expect(match.nodeText).toBe("发送促销邮件");
  });

  it("runtimeBusinessPolicyDecision：命中禁止项拦截、未命中放行", () => {
    const hit = runtimeBusinessPolicyDecision(wf, { id: "n1", title: "发送促销邮件", type: "ai" });
    expect(hit.allowed).toBe(false);
    expect(hit.code).toBe("forbidden_business_action");
    expect(hit.reason).toBe("用户明确要求“不要给客户发促销邮件”，当前步骤“发送促销邮件”与该禁止项冲突。");
    expect(hit.match).toMatchObject({ matched: true, directive: "不要给客户发促销邮件", actionFamilies: ["send"], objectFamilies: ["mail"] });

    const allow = runtimeBusinessPolicyDecision(wf, { id: "n2", title: "读取客户资料", type: "ai" });
    expect(Object.keys(allow).sort()).toEqual(["allowed", "code", "reason"]);
    expect(allow).toEqual({ allowed: true, code: "allowed", reason: "未命中用户明确禁止项" });
  });
});
