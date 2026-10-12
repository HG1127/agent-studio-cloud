import { createElement } from "react";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { ToolSpec, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { canvasToolBindingSummary, toolBindingChanges, toolBindingStatus } from "@/features/workflow-canvas/tool-binding-status";
import { WorkflowNodeView } from "@/features/workflow-canvas/CustomNodes";
import { FrozenNodeDetails } from "@/features/versions/FrozenNodeDetails";

vi.mock("@xyflow/react", () => ({ Handle: () => null, Position: { Left: "left", Right: "right" } }));
afterEach(cleanup);

const option = ToolRegistryOption.parse({ id: "customer.lookup", name: "查询客户", action: "lookup", scope: "customer.read", risk: "high", protocol: "mcp-streamable-http", operationKind: "read" });
const tool = ToolSpec.parse({ connector: option.name, action: option.action, scope: option.scope, risk: option.risk, registryToolId: option.id, protocol: option.protocol, operationKind: option.operationKind });

describe("工具登记协议和读写声明的快照核对", () => {
  it("相同真实快照仍只是已选择，不冒充连接检查或授权完成", () => {
    expect(toolBindingChanges(tool, option)).toEqual([]);
    expect(toolBindingStatus({ tool }, [option])).toBe("selected");
  });
  it.each(["http-json", "mcp-streamable-http"] as const)("真实 %s 登记标识为 demo 时仍核对实际快照及失效状态", (protocol) => {
    const registration = ToolRegistryOption.parse({ ...option, id: "demo", protocol });
    const snapshot = ToolSpec.parse({ ...tool, registryToolId: registration.id, protocol });
    const before = JSON.stringify({ registration, snapshot });
    expect(toolBindingChanges(snapshot, registration)).toEqual([]);
    expect(toolBindingStatus({ tool: snapshot }, [registration])).toBe("selected");
    expect(toolBindingStatus({ tool: snapshot }, [])).toBe("unavailable");
    expect(toolBindingStatus({ tool: { ...snapshot, action: "changed" } }, [registration])).toBe("changed");
    expect(toolBindingStatus({ tool: { ...snapshot, unresolved: true } }, [registration])).toBe("unavailable");
    expect(toolBindingStatus({ tool: { ...snapshot, connector: "unbound", unresolved: true } }, [registration])).toBe("unbound");
    expect(toolBindingStatus({ tool: { ...snapshot, registryToolId: null } }, [registration])).toBe("unbound");
    expect(JSON.stringify({ registration, snapshot })).toBe(before);
  });
  it.each(["ordinary-demo-step", "demo", null, undefined])("演示只由显式协议判定，空登记与缺省登记不变造能力，失效仍优先 %#", (registryToolId) => {
    const snapshot = ToolSpec.parse({ ...tool, registryToolId, protocol: "demo" });
    const before = JSON.stringify(snapshot);
    expect(toolBindingStatus({ tool: snapshot }, [])).toBe("demo");
    expect(toolBindingStatus({ tool: { ...snapshot, registryToolId: "demo" } }, [option])).toBe("demo");
    expect(toolBindingStatus({ tool: { ...snapshot, unresolved: true } }, [])).toBe("unavailable");
    expect(toolBindingStatus({ tool: { ...snapshot, connector: "unbound", unresolved: true } }, [])).toBe("unbound");
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it.each([
    { protocol: "demo", registryToolId: null, unresolved: false, badge: "demo", frozen: "已冻结演示工具设置，不是实际业务连接。" },
    { protocol: "demo", registryToolId: "ordinary-demo-step", unresolved: false, badge: "demo", frozen: "已冻结演示工具设置，不是实际业务连接。" },
    { protocol: "demo", registryToolId: null, unresolved: true, badge: "unbound", frozen: "已保存工具要求，但未冻结有效绑定。" },
    { protocol: "demo", registryToolId: "demo", unresolved: true, badge: "unbound", frozen: "已保存工具要求，但未冻结有效绑定。" },
    { protocol: "http-json", registryToolId: "demo", unresolved: false, badge: "real", frozen: "已冻结工具绑定；当前连接、权限和执行可用性未在此核对。" },
    { protocol: "mcp-streamable-http", registryToolId: "demo", unresolved: false, badge: "real", frozen: "已冻结工具绑定；当前连接、权限和执行可用性未在此核对。" },
    { protocol: "http-json", registryToolId: null, unresolved: false, badge: "unbound", frozen: "已保存工具要求，但未冻结有效绑定。" },
  ])("真实画布和冻结详情按协议显示，空演示登记不误报未绑定 %#", ({ protocol, registryToolId, unresolved, badge, frozen }) => {
    const node = WorkflowNode.parse({ id: "lookup", title: "查询客户", type: "tool", tool: { ...tool, protocol, registryToolId, unresolved }, next: "end" });
    const workflow = WorkflowDraft.parse({ id: "render-protocol", startNodeId: node.id, rootAgent: { id: "agent", name: "业务助手", role: "核对" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: { [node.id]: node, end: { id: "end", title: "完成", type: "end" } } });
    const before = JSON.stringify({ node, workflow });
    const canvas = render(createElement(WorkflowNodeView, { id: node.id, data: { node }, type: node.type, selected: false, dragging: false, draggable: false, selectable: true, deletable: false, isConnectable: false, zIndex: 0, positionAbsoluteX: 0, positionAbsoluteY: 0 }));
    expect(within(canvas.container).queryByText("演示") !== null).toBe(badge === "demo");
    expect(within(canvas.container).queryByText("未绑定工具") !== null).toBe(badge === "unbound");
    const details = render(createElement(FrozenNodeDetails, { node, workflow, onSelect: vi.fn() }));
    expect(within(details.container).getByText((text) => text.startsWith(frozen))).toBeInTheDocument();
    if (badge === "demo") expect(within(details.container).queryByText(/已保存工具要求，但未冻结有效绑定/)).not.toBeInTheDocument();
    if (badge === "unbound") expect(within(details.container).queryByText(/已冻结演示工具设置/)).not.toBeInTheDocument();
    expect(JSON.stringify({ node, workflow })).toBe(before);
  });
  it.each([
    { changed: { protocol: "http-json" }, label: "连接方式" },
    { changed: { operationKind: "action" }, label: "读写约定" },
    { changed: { operationKind: undefined }, label: "读写约定" },
  ])("只变化 $label 也标记待重新核对，原快照不改", ({ changed, label }) => {
    const snapshot = ToolSpec.parse({ ...tool, ...changed });
    expect(toolBindingChanges(snapshot, option)).toEqual([label]);
    expect(toolBindingStatus({ tool: snapshot }, [option])).toBe("changed");
    expect(snapshot).toEqual(ToolSpec.parse({ ...tool, ...changed }));
  });
  it("旧登记缺少协议仍使用真实后端兼容默认，不根据风险补造读写声明", () => {
    const legacy = ToolRegistryOption.parse({ ...option, protocol: undefined, operationKind: undefined });
    const snapshot = ToolSpec.parse({ ...tool, protocol: "http-json", operationKind: undefined });
    expect(toolBindingChanges(snapshot, legacy)).toEqual([]);
    expect(toolBindingChanges({ ...snapshot, operationKind: "read" }, legacy)).toEqual(["读写约定"]);
  });
  it("根节点与两种内嵌工作都参与协议变更统计并定位其画布所有者", () => {
    const stale = { ...tool, protocol: "http-json" };
    const draft = WorkflowDraft.parse({ id: "protocol-check", rootAgent: { id: "agent", name: "业务助手", role: "核对" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "root" },
      root: WorkflowNode.parse({ id: "root", title: "查询客户", type: "tool", tool: stale, next: "parallel" }),
      parallel: { id: "parallel", title: "并行工作", type: "parallel", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [{ id: "one", label: "客户核对", steps: [{ id: "lookup", title: "查询客户", type: "tool", tool: stale }] }] }, next: "group" },
      group: { id: "group", title: "步骤组", type: "subflow", subflow: { name: "客户工作", steps: [{ id: "lookup", title: "查询客户", type: "tool", tool: stale }] }, next: "end" },
      end: { id: "end", title: "完成", type: "end" },
    } });
    expect(canvasToolBindingSummary(draft, [option])).toMatchObject({ total: 3, nested: 2, changed: 3, selected: 0, firstAttentionId: "root" });
    expect(draft.nodes.root.tool?.protocol).toBe("http-json");
  });
});
