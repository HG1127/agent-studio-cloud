// 归一化说明：管道测试不做金测逐字节对齐（Task 4-7 金测已各自覆盖），只断言管道产物满足契约。
// 容错路径用 vi.mock 把 compileIntentWorkflow 换成一次性抛错实现（控制方裁定 2：链上异常不得
// 穿透到 UI）；mock 默认透传真实编译器，首个用例跑的仍是完整真实管道。
import { describe, expect, it, vi } from "vitest";
import golden1 from "../fixtures/domain/intent-golden-1.json";
import { WorkflowDraft } from "@/contracts/workflow";
import { bindDemoCapabilities, buildAgentDraft } from "@/server/domain/pipeline";

const mocks = vi.hoisted(() => ({ compileIntentWorkflow: vi.fn() }));

vi.mock("@/server/domain/intent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/domain/intent")>();
  mocks.compileIntentWorkflow.mockImplementation(actual.compileIntentWorkflow);
  return { ...actual, compileIntentWorkflow: mocks.compileIntentWorkflow };
});

describe("创建助手管道 buildAgentDraft", () => {
  it("intent-golden-1 文本：草稿含业务落地、审计摘要与 issues 数组，且通过草稿契约校验", () => {
    const result = buildAgentDraft({ name: golden1.input.name, intentText: golden1.input.text });
    expect(result.draft).not.toBeNull();
    expect(result.draft?.businessGrounding).toBeTruthy();
    expect(Array.isArray(result.issues)).toBe(true);
    expect(result.diagnostics.error).toBeUndefined();
    // M1 演示绑定后 business_source_unresolved 消失（见下条用例说明），剩余 2 个 critical 全在发布豁免清单内
    expect(result.diagnostics.audit).toMatchObject({ status: "blocked", counts: { critical: 2 } });
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
