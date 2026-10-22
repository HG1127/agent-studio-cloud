import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { ToolSpec, WorkflowNode } from "@/contracts/workflow";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";

const option = ToolRegistryOption.parse({ id: "customer.read", name: "客户查询", action: "lookup", scope: "customer.read", risk: "high", protocol: "mcp-streamable-http", operationKind: "read" });
const oldTool = ToolSpec.parse({ connector: "客户查询", action: "lookup", scope: "customer.read", risk: "high", registryToolId: option.id, protocol: "http-json", operationKind: "action", maxRetries: 4 });
const node = WorkflowNode.parse({ id: "lookup", title: "查询客户资料", type: "tool", next: "later", description: "保留工作说明", retry: { maxAttempts: 2, backoffMs: 7000 }, tool: oldTool });

describe("画布读取真实登记的连接方式和读写约定", () => {
  it.each([
    { protocol: "mcp-streamable-http", operationKind: "read", risk: "high" },
    { protocol: "mcp-streamable-http", operationKind: "action", risk: "low" },
    { protocol: "http-json", operationKind: "read", risk: "medium" },
    { protocol: undefined, operationKind: undefined, risk: "low" },
    { protocol: undefined, operationKind: undefined, risk: "high" },
  ])("选取登记配置 $protocol/$operationKind/$risk 时不按风险推测读写", (metadata) => {
    const selected = ToolRegistryOption.parse({ ...option, ...metadata });
    const onNodeChange = vi.fn();
    render(<NodeInspector node={node} toolOptions={[selected]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(onNodeChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: "业务工具" }), { target: { value: selected.id } });
    const updated = onNodeChange.mock.lastCall![0] as WorkflowNode;
    expect(updated).toMatchObject({ next: node.next, description: node.description, retry: node.retry, tool: { protocol: selected.protocol ?? "http-json", risk: selected.risk, maxRetries: 4, registryToolId: selected.id } });
    expect(updated.tool?.operationKind).toBe(selected.operationKind);
    if (selected.operationKind === undefined) expect(updated.tool).not.toHaveProperty("operationKind");
    expect(WorkflowNode.safeParse(updated).success).toBe(true);
    expect(node.tool).toEqual(oldTool);
  });

  it("只有协议和读写约定变化也必须确认，返回不改旧绑定", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<NodeInspector node={node} toolOptions={[option]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByText(/工具配置已变化/)).toHaveTextContent("连接方式、读写约定");
    expect(onNodeChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "核对并重新绑定" }));
    const dialog = screen.getByRole("dialog", { name: "更新这个工具步骤的绑定？" });
    expect(dialog).toHaveTextContent("不代表连接已验证或权限已获批");
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    expect(onNodeChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "核对并重新绑定" }));
    await user.click(screen.getByRole("button", { name: "确认重新绑定" }));
    const updated = onNodeChange.mock.lastCall![0] as WorkflowNode;
    expect(updated).toMatchObject({ next: node.next, retry: node.retry, tool: { protocol: "mcp-streamable-http", operationKind: "read", maxRetries: 4 } });
    rerender(<NodeInspector node={updated} toolOptions={[option]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.queryByText(/工具配置已变化/)).not.toBeInTheDocument();
  });

  it.each(["parallel", "subflow"] as const)("%s 内嵌选择同样保留真实连接约定和其他工作", (type) => {
    const steps = [{ id: "lookup", title: "查询客户", type: "tool", next: "later", retry: { maxAttempts: 2, backoffMs: 7000 }, tool: oldTool }, { id: "later", title: "核对业务结果", type: "system" }];
    const group = WorkflowNode.parse(type === "subflow"
      ? { id: "group", title: "客户处理", type, subflow: { name: "客户工作", steps } }
      : { id: "group", title: "客户处理", type, parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [{ id: "customer", label: "客户工作", steps }, { id: "other", label: "另一项工作", steps: [{ id: "keep", title: "保持原工作", type: "system" }] }] } });
    const onNodeChange = vi.fn();
    render(<NodeInspector node={group} toolOptions={[option]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(onNodeChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("combobox", { name: type === "subflow" ? "步骤组步骤 1 业务工具" : "并行工作 1 步骤 1 业务工具" }), { target: { value: option.id } });
    const updated = onNodeChange.mock.lastCall![0] as WorkflowNode;
    const changedSteps = type === "subflow" ? updated.subflow!.steps : updated.parallel!.branches[0].steps;
    expect(changedSteps[0]).toMatchObject({ id: "lookup", next: "later", retry: steps[0].retry, tool: { protocol: "mcp-streamable-http", operationKind: "read", maxRetries: 4, risk: "high" } });
    expect(changedSteps[1]).toEqual(steps[1]);
    if (type === "parallel") expect(updated.parallel!.branches[1]).toEqual(group.parallel!.branches[1]);
    expect(WorkflowNode.safeParse(updated).success).toBe(true);
    expect(group[type === "subflow" ? "subflow" : "parallel"]).toBeDefined();
  });
});
