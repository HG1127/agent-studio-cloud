import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FrozenVersionPage from "@/app/(console)/agents/[agentId]/versions/[versionId]/page";
import { ToolOperationConfig } from "@/contracts/tool-operation";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { FrozenNodeContracts } from "@/features/versions/FrozenNodeContracts";
import { frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { frozenAgentId, frozenManifest, frozenVersionId } from "../fixtures/frozen-version";
import { nodeToolOperationTestOption, nodeToolOperationWorkflow } from "../fixtures/node-tool-operation-workflow";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: read }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div>只读画布</div>, Background: () => null, Handle: () => null, Position: { Left: "left", Right: "right" } }));

const tool = nodeToolOperationTestOption();
const workflow = nodeToolOperationWorkflow(tool);
function originalNode(config: unknown, changes: Partial<WorkflowNode> = {}): WorkflowNode {
  return { ...workflow.nodes.top, ...changes, toolOperation: config } as WorkflowNode;
}
async function page(raw: unknown) {
  read.mockResolvedValue({ agentName: "冻结订单助手", version: 3, status: "retired", manifest: { ...frozenManifest, workflowSnapshot: raw }, createdAt: new Date("2026-10-10T00:00:00Z") });
  return FrozenVersionPage({ params: Promise.resolve({ agentId: frozenAgentId, versionId: frozenVersionId }), searchParams: Promise.resolve({}) });
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("冻结工具防重原快照闭环", () => {
  it("未保存时明确缺失，不造配置、控件、网络请求或浏览器存储", () => {
    const network = vi.spyOn(globalThis, "fetch"), storage = vi.spyOn(Storage.prototype, "setItem");
    const before = JSON.stringify(workflow);
    const { container } = render(<FrozenNodeContracts node={workflow.nodes.top} workflow={workflow} />);
    expect(screen.getByText("未保存工具防重设置，不补造业务范围或标识来源。")).toBeVisible();
    expect(container.querySelector("input,select,textarea,button")).toBeNull();
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(JSON.stringify(workflow)).toBe(before);
  });

  it("显式整数零按原值展示，不被当成缺失，也不声称当前登记或执行已核对", () => {
    const config = ToolOperationConfig.parse({ scope: tool.scope, key: { kind: "literal", value: 0 } });
    const node = originalNode(config), before = JSON.stringify(node);
    const { container } = render(<FrozenNodeContracts node={node} workflow={workflow} />);
    expect(screen.getByText("原业务标识固定值：0")).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原业务标识固定值原值").textContent!)).toBe(0);
    expect(screen.getByText(/零可以作为整数，否、空值、对象和列表不能作为业务标识/)).toBeVisible();
    expect(screen.getByText(/不查询当前工具登记或补写有效期/)).toBeVisible();
    expect(screen.getByText(/此处不保存、重发或调用工具/)).toBeVisible();
    expect(container.textContent).not.toContain(tool.id);
    expect(JSON.stringify(node)).toBe(before);
  });

  it.each([false, null, "", {}, []])("原固定值 %j 只读保留，不被转成默认标识", (value) => {
    const node = originalNode({ scope: tool.scope, key: { kind: "literal", value } }), before = JSON.stringify(node);
    render(<FrozenNodeContracts node={node} />);
    expect(JSON.parse(screen.getByLabelText("原业务标识固定值原值").textContent!)).toEqual(value);
    expect(screen.getByText(/这里不读取实际任务数据，也不验证运行时取值/)).toBeVisible();
    expect(JSON.stringify(node)).toBe(before);
  });

  it("冻结投影保留省略路径而不是解析默认值，真实版本页面只读展示原输入来源", async () => {
    const config = { scope: tool.scope, key: { kind: "input" } };
    const raw = { ...workflow, startNodeId: "top", nodes: { ...workflow.nodes, top: originalNode(config) } };
    const before = JSON.stringify(raw);
    const parsed = WorkflowDraft.parse(raw), view = frozenWorkflowView(parsed, raw);
    expect(parsed.nodes.top.toolOperation?.key).toHaveProperty("path", []);
    expect(view.nodes.top.toolOperation).toEqual(config);
    expect(view.nodes.top.toolOperation?.key).not.toHaveProperty("path");
    const network = vi.spyOn(globalThis, "fetch"), storage = vi.spyOn(Storage.prototype, "setItem");
    render(await page(raw));
    const region = screen.getByRole("region", { name: "冻结字段约定只读核对" });
    expect(region).toHaveTextContent("业务标识来源：原任务输入");
    expect(region).toHaveTextContent("未保存来源字段层级，不补造默认层级");
    expect(screen.queryByLabelText("原业务标识来源层级")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /应用到当前草稿|清除防重设置|保存草稿|开始运行/ })).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledExactlyOnceWith(frozenAgentId, frozenVersionId, expect.any(String));
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(before);
  });

  it("显式整个来源和两层含点路径严格区分，不拆分已保存的字段名", () => {
    const { rerender } = render(<FrozenNodeContracts node={originalNode({ scope: tool.scope, key: { kind: "input", path: [] } })} />);
    expect(screen.getByText(/业务标识来源：原任务输入 · 原设置取整个来源/)).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原业务标识来源层级").textContent!)).toEqual([]);
    rerender(<FrozenNodeContracts node={originalNode({ scope: tool.scope, key: { kind: "input", path: ["订单.资料", "业务编号"] } })} />);
    expect(screen.getByText(/取2层来源字段/)).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原业务标识来源层级").textContent!)).toEqual(["订单.资料", "业务编号"]);
    fireEvent.click(screen.getByText("开发者原业务标识层级（脱敏只读）"));
    expect(screen.getByText(/含句点的字段名仍是一个层级/)).toBeVisible();
  });

  it.each([
    ["prepare", "顶层步骤：准备业务编号"],
    ["group.submit", "步骤组：核对一组订单 · 核对组内订单"],
    ["parallel.left.check", "并行步骤：分别核对订单 · 分支：第一项核对 · 第一项订单"],
    ["parallel.right.check", "并行步骤：分别核对订单 · 分支：第二项核对 · 第二项订单"],
  ])("保存的关联 %s 仅按同一冻结流程定位，不以同名短步骤猜来源", (nodeId, label) => {
    const node = originalNode({ scope: tool.scope, key: { kind: "output", nodeId, path: ["原.字段"] } });
    const { container } = render(<FrozenNodeContracts node={node} workflow={workflow} />);
    expect(screen.getByText("业务标识来源：" + label + " · 取1层来源字段")).toBeVisible();
    expect(container.textContent).not.toContain(nodeId);
    expect(container.textContent).not.toContain(tool.id);
  });

  it("缺失流程、来源失效与短标识都不猜测；结构冲突也不任选一个来源", () => {
    const node = originalNode({ scope: tool.scope, key: { kind: "output", nodeId: "check", path: [] } });
    const { container, rerender } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText(/未能在提供的冻结流程中定位来源/)).toBeVisible();
    rerender(<FrozenNodeContracts node={node} workflow={workflow} />);
    expect(screen.getByText(/未能在提供的冻结流程中定位来源/)).toBeVisible();
    expect(container.textContent).not.toContain('"check"');
    const duplicate = { ...workflow, nodes: { ...workflow.nodes, "group.submit": WorkflowNode.parse({ id: "group.submit", title: "重复关联", type: "ai" }) } };
    rerender(<FrozenNodeContracts node={originalNode({ scope: tool.scope, key: { kind: "output", nodeId: "group.submit", path: [] } })} workflow={duplicate} />);
    expect(screen.getByText(/无法唯一定位来源/)).toBeVisible();
  });

  it("未知、不适用和不完整配置保留原定义，不补范围或重绑定", () => {
    const raw = { scope: tool.scope, key: { kind: "input" }, futureRule: { original: 0, enabled: false } };
    const node = originalNode(raw, { type: "ai" }), before = JSON.stringify(node);
    const { rerender } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText(/原工具防重设置含未知、不适用或无法识别/)).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原工具防重定义").textContent!)).toEqual(raw);
    expect(JSON.stringify(node)).toBe(before);
    rerender(<FrozenNodeContracts node={originalNode({ key: { kind: "unknown", nodeId: "missing-private-source" } })} />);
    expect(screen.getByText(/原业务范围：未保存，不补造范围/)).toBeVisible();
    expect(screen.getByText(/原业务标识来源无法识别或没有保存/)).toBeVisible();
    expect(screen.getByLabelText("原工具防重定义")).not.toHaveTextContent("missing-private-source");
  });

  it("组内与并行分支读取原字段，省略路径、零否、未知键及原步骤标识都不改写", () => {
    const group = workflow.nodes.group;
    const rawGroup = { ...group, subflow: { ...group.subflow!, steps: group.subflow!.steps.map((step, i) => i ? { ...step, toolOperation: { scope: tool.scope, key: { kind: "input" }, futureRule: { amount: 0 } } } : step) } };
    const node = WorkflowNode.parse(rawGroup), before = JSON.stringify(node);
    const { rerender, container } = render(<FrozenNodeContracts node={node} workflow={workflow} />);
    expect(screen.getByText(/未保存来源字段层级，不补造默认层级/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByLabelText("原工具防重定义").textContent!)).toEqual(rawGroup.subflow.steps[1].toolOperation);
    expect(JSON.stringify(node)).toBe(before);
    const parallel = workflow.nodes.parallel;
    const rawParallel = { ...parallel, parallel: { ...parallel.parallel!, branches: parallel.parallel!.branches.map((branch, i) => ({ ...branch, steps: [{ ...branch.steps[0], toolOperation: { scope: tool.scope, key: { kind: "literal", value: i ? false : 0 } } }] })) } };
    const original = WorkflowNode.parse(rawParallel), originalBefore = JSON.stringify(original);
    rerender(<FrozenNodeContracts node={original} workflow={workflow} />);
    expect(screen.getAllByLabelText("原业务标识固定值原值").map((item) => JSON.parse(item.textContent!))).toEqual([0, false]);
    expect(container.textContent).not.toContain(tool.id);
    expect(container.textContent).not.toContain('"check"');
    expect(JSON.stringify(original)).toBe(originalBefore);
  });

  it("固定值脱敏只影响展示，不改变原标识、未知字段或业务范围", () => {
    const config = { scope: tool.scope, key: { kind: "literal", value: "apiKey=private-frozen-business-secret-2026" }, future: { enabled: false } };
    const node = originalNode(config), before = JSON.stringify(node);
    const { container } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByLabelText("原业务标识固定值原值")).toHaveTextContent("已隐藏敏感信息");
    expect(container.textContent).not.toContain("private-frozen-business-secret-2026");
    expect(JSON.stringify(node)).toBe(before);
  });

  it("不安全原配置在读取访问器前拒绝，原流程不安全时也不定位来源", () => {
    const execute = vi.fn();
    const raw: Record<string, unknown> = { scope: tool.scope };
    Object.defineProperty(raw, "key", { enumerable: true, get: execute });
    const { rerender } = render(<FrozenNodeContracts node={originalNode(raw)} />);
    expect(screen.getByText(/步骤包含无法安全读取的内容/)).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
    const unsafe = { ...workflow }; Object.defineProperty(unsafe, "nodes", { enumerable: true, get: execute });
    rerender(<FrozenNodeContracts node={originalNode({ scope: tool.scope, key: { kind: "output", nodeId: "prepare", path: [] } })} workflow={unsafe} />);
    expect(screen.getByText(/提供的流程含无法安全核对的内容/)).toBeVisible();
    expect(screen.getByText(/未能在提供的冻结流程中定位来源/)).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
  });

  it("冻结页面遇到违背契约的原配置明确读取失败，不从当前草稿或解析默认值造成功页", async () => {
    const raw = { ...workflow, startNodeId: "top", nodes: { ...workflow.nodes, top: originalNode({ scope: tool.scope, key: { kind: "unknown" } }) } };
    render(await page(raw));
    expect(screen.getByRole("heading", { name: "已保存版本暂时无法核对" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "已保存的工具防重设置" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("不会修改冻结版本");
  });
});
