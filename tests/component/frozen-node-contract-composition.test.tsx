import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FrozenVersionPage from "@/app/(console)/agents/[agentId]/versions/[versionId]/page";
import { WorkflowDraft } from "@/contracts/workflow";
import { frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { frozenAgentId, frozenDraft, frozenManifest, frozenVersionId } from "../fixtures/frozen-version";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: read }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div>只读画布</div>, Background: () => null, Handle: () => null, Position: { Left: "left", Right: "right" } }));

const schema = { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] };
function saved() {
  return { ...frozenDraft, startNodeId: "compose", nodes: { ...frozenDraft.nodes, compose: {
    ...frozenDraft.nodes.compose, modelOutput: { format: "json", schema, futureSetting: "原未知约定" },
    inputMapping: { fields: [{ target: ["business.amount"], source: { kind: "literal", value: 0 }, fallback: false }] },
  } } };
}
async function page(workflow: unknown = saved()) {
  read.mockResolvedValue({ agentName: "冻结客服助手", version: 2, status: "retired",
    manifest: { ...frozenManifest, workflowSnapshot: workflow }, createdAt: new Date("2026-10-09T00:00:00Z") });
  return FrozenVersionPage({ params: Promise.resolve({ agentId: frozenAgentId, versionId: frozenVersionId }), searchParams: Promise.resolve({}) });
}
beforeEach(() => vi.clearAllMocks());

describe("真实冻结页面的原字段约定组合", () => {
  it("页面接入原快照，缺省方式和次数不被默认值冒充，未知字段仍在脱敏开发数据", async () => {
    const original = saved(), before = JSON.stringify(original);
    render(await page(original));
    const region = screen.getByRole("region", { name: "冻结字段约定只读核对" });
    expect(region).toHaveTextContent("未保存请求方式，不以默认方式替代原定义");
    expect(region).toHaveTextContent("未保存额外修正次数，不补写默认次数");
    expect(region).toHaveTextContent("未知、不适用或未通过当前规则");
    expect(region).toHaveTextContent("未保存全部上游成果携带设置，不补写默认值");
    expect(region).toHaveTextContent("未保存是否必须提供，不补写默认值");
    expect(region).toHaveTextContent("固定值：0");
    expect(region).toHaveTextContent("来源缺失时的原固定值：否");
    expect(screen.getByLabelText("冻结步骤设置内容")).toHaveTextContent("原未知约定");
    expect(screen.getByLabelText("冻结步骤设置内容")).not.toHaveTextContent("private-frozen-secret-2026");
    expect(screen.queryByRole("button", { name: /保存草稿|应用到当前草稿|提交样例做只读试算|开始运行/ })).not.toBeInTheDocument();
    expect(JSON.stringify(original)).toBe(before);
    expect(read).toHaveBeenCalledExactlyOnceWith(frozenAgentId, frozenVersionId, expect.any(String));
  });
  it("只读视图保留原逐层数组、零否、未知属性与未保存标记，不修改原始快照", () => {
    const original = saved(), before = JSON.stringify(original);
    const view = frozenWorkflowView(WorkflowDraft.parse(original), original);
    expect(view.nodes.compose.modelOutput).toEqual(original.nodes.compose.modelOutput);
    expect(view.nodes.compose.inputMapping).toEqual(original.nodes.compose.inputMapping);
    expect(view.nodes.compose.modelOutput).not.toHaveProperty("providerMode");
    expect(view.nodes.compose.modelOutput).not.toHaveProperty("maxRepairAttempts");
    expect(view.nodes.compose.inputMapping).not.toHaveProperty("includeUpstreamOutputs");
    expect(JSON.stringify(original)).toBe(before);
  });
  it("另一份快照不能混入已核对的冻结版本", () => {
    const original = saved(), changed = { ...original, startNodeId: "done" };
    expect(() => frozenWorkflowView(WorkflowDraft.parse(original), changed)).toThrow("Frozen source mismatch");
  });
  it("非被动数据在读取 getter 之前拒绝，不拿已解析默认值替代", () => {
    const getter = vi.fn();
    const original = saved();
    Object.defineProperty(original, "private", { enumerable: true, get: getter });
    expect(() => frozenWorkflowView(frozenDraft, original)).toThrow("Unsafe frozen workflow");
    expect(getter).not.toHaveBeenCalled();
  });
  it("确实未保存两个字段时只说明缺失，不补上模型或映射约定", async () => {
    render(await page({ ...saved(), nodes: { ...frozenDraft.nodes } }));
    const region = screen.getByRole("region", { name: "冻结字段约定只读核对" });
    expect(region).toHaveTextContent("未保存模型结果字段约定");
    expect(region).toHaveTextContent("未保存输入映射");
    expect(within(region).queryByRole("textbox")).not.toBeInTheDocument();
  });
});
