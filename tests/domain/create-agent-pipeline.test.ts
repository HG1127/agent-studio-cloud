// 归一化说明：管道测试不做金测逐字节对齐（Task 4-7 金测已各自覆盖），只断言管道产物满足契约。
// 容错路径用 vi.mock 把 compileIntentWorkflow 换成一次性抛错实现（控制方裁定 2：链上异常不得
// 穿透到 UI）；mock 默认透传真实编译器，首个用例跑的仍是完整真实管道。
import { describe, expect, it, vi } from "vitest";
import golden1 from "../fixtures/domain/intent-golden-1.json";
import { WorkflowDraft } from "@/contracts/workflow";
import { bindDemoCapabilities, buildAgentDraft, buildManifest } from "@/server/domain/pipeline";
import { validateOutputContract } from "@/server/domain/runtime/output-contract";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";

const mocks = vi.hoisted(() => ({ compileIntentWorkflow: vi.fn() }));

vi.mock("@/server/domain/intent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/domain/intent")>();
  mocks.compileIntentWorkflow.mockImplementation(actual.compileIntentWorkflow);
  return { ...actual, compileIntentWorkflow: mocks.compileIntentWorkflow };
});

describe("创建助手管道 buildAgentDraft", () => {
  it("意图明确提到已配置业务系统时自动绑定真实工具", () => {
    const result = buildAgentDraft({
      name: "客户跟进助手",
      intentText: "收到客户跟进结果后，通过客户系统更新客户状态，最后输出处理回执",
      capabilities: [{
        id: "crm.update", label: "客户系统", action: "update_customer", searchText: "更新客户状态",
        scope: "customer.write", source: "connected-registry", risk: "medium", registryToolId: "crm.update",
        protocol: "http-json", inputSchema: { type: "object" }, outputSchema: { type: "object" },
      }],
    });
    const tools = Object.values(result.draft?.nodes ?? {}).filter((node) => node.type === "tool");
    expect(tools).toContainEqual(expect.objectContaining({
      tool: expect.objectContaining({ registryToolId: "crm.update", protocol: "http-json" }),
    }));
  });

  it("intent-golden-1 文本：草稿含业务落地、审计摘要与 issues 数组，且通过草稿契约校验", () => {
    const result = buildAgentDraft({ name: golden1.input.name, intentText: golden1.input.text });
    expect(result.draft).not.toBeNull();
    expect(result.draft?.businessGrounding).toBeTruthy();
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.diagnostics.error).toBeUndefined();
    // 创建期已经补齐最终交付契约，隐藏控制节点不参与业务目标误报。
    expect(result.draft?.outputContract?.fields.length).toBeGreaterThan(0);
    expect(result.diagnostics.audit).toMatchObject({ status: "ready", score: 100, counts: { critical: 0 } });
    expect(result.issues.filter((issue) => issue.severity === "critical")).toEqual([]);
    expect(() => WorkflowDraft.parse(result.draft)).not.toThrow();
  });

  it("M1 演示绑定：工具节点绑定为演示工具，未解析清单清空，业务来源阻塞随之消失", () => {
    // business_source_unresolved 消失是预期行为不是巧合：绑定后 grounding 的 executableTool /
    // knowledgeBound 判定放行，编译产物不再有数据来源阻塞——这正是演示发布策略要打通的发布成功路径。
    const result = buildAgentDraft({ name: golden1.input.name, intentText: golden1.input.text });
    const draft = result.draft;
    expect(draft).not.toBeNull();
    for (const node of Object.values(draft?.nodes ?? {})) {
      if (node.type !== "tool") continue;
      expect(node.tool?.registryToolId).toBe("demo");
      expect(node.tool?.protocol).toBe("demo");
      expect(node.tool?.unresolved).not.toBe(true);
    }
    expect(draft?.runtimeRequirements?.unresolvedTools).toEqual([]);
    expect(result.issues.some((issue) => issue.code === "business_source_unresolved")).toBe(false);
  });

  it("带员工确认的默认草稿不会把隐藏检查节点作为最终交付来源", () => {
    const result = buildAgentDraft({
      name: "客服测试助手",
      intentText: "收到客户咨询后生成回复方案，发送前由负责人确认，最后输出回复邮件",
    });

    expect(result.draft).not.toBeNull();
    expect(validateOutputContract(result.draft!.outputContract?.fields ?? [], result.draft!.nodes)).toBeNull();
    const sourceId = result.draft!.outputContract?.fields[0]?.sourceNodeId;
    expect(sourceId).toBeTruthy();
    expect(result.draft!.nodes[sourceId!]?.ui?.visibility).not.toBe("control");
    expect(result.draft!.nodes[sourceId!]?.controlPlane?.hiddenByDefault).not.toBe(true);
  });

  it("链上抛错时不穿透异常：草稿为空、issues 为空数组、诊断带错误信息", () => {
    mocks.compileIntentWorkflow.mockImplementationOnce(() => {
      throw new Error("模拟解析失败");
    });
    const result = buildAgentDraft({ name: golden1.input.name, intentText: golden1.input.text });
    expect(result.draft).toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.diagnostics.error).toBe("模拟解析失败");
    expect(result.diagnostics.audit).toBeUndefined();
  });

  it("业务蓝图中的资料清单会生成可填写的运行输入字段", () => {
    const result = buildAgentDraft({
      name: "售后助手",
      intentText: [
        "处理售后工单并给出回复建议",
        "触发条件：收到新工单后",
        "需要的业务输入：工单内容、客户等级、商品信息",
        "最终交付：回复邮件和处理记录",
        "必须遵守：发送前必须由负责人确认",
      ].join("\n"),
    });
    expect(result.draft?.variables).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "input_1", label: "工单内容", type: "string", scope: "run", required: true }),
      expect.objectContaining({ name: "input_2", label: "客户等级" }),
      expect.objectContaining({ name: "input_3", label: "商品信息" }),
    ]));
    expect(result.draft?.outputContract?.fields.length).toBeGreaterThan(0);
    expect(result.draft?.nodes[result.draft.startNodeId].title).toBe("收到新工单后");
    expect(Object.values(result.draft?.nodes ?? {}).some((node) =>
      /^(?:触发条件|需要的业务输入|的业务输入)[：:]/.test(node.title),
    )).toBe(false);
    expect(Object.values(result.draft?.nodes ?? {})).toContainEqual(expect.objectContaining({
      title: "生成回复邮件和处理记录",
      type: "ai",
      ui: { visibility: "business" },
    }));
    expect(result.draft?.outputContract?.fields).toEqual([
      expect.objectContaining({ path: "output_1", label: "回复邮件和处理记录", required: true }),
    ]);
    expect(validateOutputContract(result.draft!.outputContract!.fields, result.draft!.nodes)).toBeNull();
    expect(validateWorkflowRoutes(result.draft!)).toBeNull();
    expect(result.issues.some((issue) => issue.code === "requirement_coverage")).toBe(false);
    expect(result.draft?.requirementContract?.coverage).toMatchObject({ complete: true, percent: 100 });
    expect(JSON.stringify(result.draft?.businessRequirements)).toContain("发送前必须由负责人确认");
    const manifest = buildManifest(result.draft!, {
      modelId: "mock",
      mock: true,
      connectionId: null,
      knowledgeSnapshot: [],
    });
    expect(manifest.inputContract.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "input_1", label: "工单内容", required: true }),
      expect.objectContaining({ name: "input_2", label: "客户等级", required: true }),
      expect.objectContaining({ name: "input_3", label: "商品信息", required: true }),
    ]));
  });
});

describe("bindDemoCapabilities（M1 演示绑定，compile 之后 grounding 之前调用）", () => {
  it("未绑定工具与通用知识库改绑演示来源；已绑定的节点原样保留", () => {
    const draft = WorkflowDraft.parse({
      id: "WF-demo",
      rootAgent: { id: "agt_demo", name: "演示助手", role: "演示" },
      nodes: {
        t1: {
          id: "t1", title: "查询订单", type: "tool", next: null,
          tool: { connector: "unbound", action: "unbound_tool", scope: "unbound.tool", registryToolId: null, protocol: "unbound", unresolved: true },
        },
        t2: {
          id: "t2", title: "已绑定工具", type: "tool", next: null,
          tool: { connector: "crm", action: "read_records", scope: "crm.record.read", registryToolId: "tool-1", protocol: "rest-http", unresolved: false },
        },
        k1: { id: "k1", title: "读取资料", type: "knowledge", next: null, knowledge: { space: "业务知识库" } },
        k2: { id: "k2", title: "读取指定手册", type: "knowledge", next: null, knowledge: { space: "产品手册" } },
      },
      memoryPolicy: { taskContext: true, longTerm: false },
      runtimeRequirements: { externalTools: [], unresolvedTools: [{ nodeId: "t1" }], toolReceiptVerification: true },
    });
    bindDemoCapabilities(draft);
    // connector/scope 也要一并改绑：grounding 的 executableTool 还要求 connector!=='unbound' 且 scope 不以 unbound. 开头
    expect(draft.nodes.t1.tool).toMatchObject({ registryToolId: "demo", protocol: "demo", unresolved: false, connector: "demo", scope: "demo" });
    expect(draft.nodes.t2.tool?.registryToolId).toBe("tool-1");
    expect(draft.nodes.k1.knowledge?.space).toBe("演示资料库");
    expect(draft.nodes.k2.knowledge?.space).toBe("产品手册");
    expect(draft.runtimeRequirements?.unresolvedTools).toEqual([]);
  });

  it("runtimeRequirements 缺失时补默认结构并清空未解析清单", () => {
    const draft = WorkflowDraft.parse({
      id: "WF-demo",
      rootAgent: { id: "agt_demo", name: "演示助手", role: "演示" },
      nodes: {
        t1: {
          id: "t1", title: "查询订单", type: "tool", next: null,
          tool: { connector: "unbound", action: "查询订单", scope: "unbound.tool", registryToolId: null, protocol: "unbound" },
        },
      },
      memoryPolicy: { taskContext: true, longTerm: false },
    });
    expect(draft.runtimeRequirements).toBeUndefined();
    bindDemoCapabilities(draft);
    expect(draft.runtimeRequirements?.unresolvedTools).toEqual([]);
    expect(draft.nodes.t1.tool?.unresolved).toBe(false);
  });
});
