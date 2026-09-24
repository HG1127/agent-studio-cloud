import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";

const AI_NODE = WorkflowNode.parse({ id: "step_1", title: "生成回复方案", type: "ai" });
const HUMAN_NODE = WorkflowNode.parse({
  id: "step_2",
  title: "负责人确认发送内容",
  type: "human",
  approval: { role: "客服主管", reason: "确认内容无误后再发送" },
});
const CONDITION_NODE = WorkflowNode.parse({
  id: "step_3",
  title: "分情况处理",
  type: "condition",
  condition: { source: "input.amount", operator: "eq", branches: [], defaultNext: null },
});
const KNOWLEDGE_NODE = WorkflowNode.parse({
  id: "step_4",
  title: "查阅退货资料",
  type: "knowledge",
  knowledge: { space: "业务资料库", query: "退货规则" },
});
const AGENT_CALL_NODE = WorkflowNode.parse({
  id: "step_5",
  title: "请研究助手分析",
  type: "agent_call",
  agentCall: { targetAgentId: "", versionId: "" },
});
const HANDOFF_NODE = WorkflowNode.parse({
  id: "step_6",
  title: "交给履约助手",
  type: "handoff",
  toAgent: { id: "", versionId: "" },
});
const WAIT_NODE = WorkflowNode.parse({
  id: "step_7", title: "等待回执", type: "wait",
  wait: { mode: "delay", durationMs: 60_000, eventKey: "", timeoutMs: 0 },
});
const EVENT_WAIT_NODE = WorkflowNode.parse({
  id: "step_event", title: "等待客户资料", type: "wait",
  wait: { mode: "event", durationMs: 0, eventKey: "customer.updated", timeoutMs: 0, payloadSchema: { type: "object" } },
});
const MEMORY_NODE = WorkflowNode.parse({
  id: "step_8", title: "参考经验", type: "memory", memory: { mode: "read", limit: 5 },
});
const LOOP_NODE = WorkflowNode.parse({
  id: "step_9", title: "逐项检查", type: "loop",
  loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 20, bodyNext: null, exitNext: null },
});
const PARALLEL_NODE = WorkflowNode.parse({
  id: "step_10", title: "同时准备材料", type: "parallel",
  parallel: {
    strategy: "all", failurePolicy: "fail_fast",
    branches: [
      { id: "branch_1", label: "准备合同", steps: [{ id: "step_1", title: "起草合同", type: "ai" }] },
      { id: "branch_2", label: "准备报价", steps: [{ id: "step_1", title: "生成报价", type: "ai" }] },
    ],
  },
});
const SUBFLOW_NODE = WorkflowNode.parse({
  id: "step_11", title: "完成交付准备", type: "subflow",
  subflow: { name: "交付准备", steps: [{ id: "step_1", title: "检查材料", type: "ai" }], inputs: [], outputs: [], failurePolicy: "checkpoint" },
});

describe("NodeInspector", () => {
  it("修改节点名称时回调携带新值", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={AI_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "生成退款方案" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "step_1", title: "生成退款方案" }));
  });

  it("编辑说明时回调携带新的描述", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={AI_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "先核对订单再回复" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ description: "先核对订单再回复" }));
  });

  it("人工节点展示负责人与确认事项，修改后回调携带新值", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={HUMAN_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("负责人")).toHaveValue("客服主管");
    expect(screen.getByLabelText("确认事项")).toHaveValue("确认内容无误后再发送");
    fireEvent.change(screen.getByLabelText("负责人"), { target: { value: "合规专员" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ approval: { role: "合规专员", reason: "确认内容无误后再发送" } }),
    );
  });

  it("条件节点说明以判断说明呈现，便于看懂判断依据", () => {
    render(<NodeInspector node={CONDITION_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("判断说明")).toBeInTheDocument();
    expect(screen.queryByLabelText("说明")).not.toBeInTheDocument();
  });

  it("条件节点可以配置数据、比较方式和分支", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={CONDITION_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("判断数据"), { target: { value: "input.total" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ condition: expect.objectContaining({ source: "input.total" }) }));
    await user.click(screen.getByRole("button", { name: "添加情况" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ condition: expect.objectContaining({ branches: [expect.objectContaining({ label: "情况 1" })] }) }));
  });

  it("等待、经验和逐项处理节点暴露运行所需设置", () => {
    const onWait = vi.fn();
    const { rerender } = render(<NodeInspector node={WAIT_NODE} onNodeChange={onWait} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("等待秒数"), { target: { value: "5" } });
    expect(onWait).toHaveBeenLastCalledWith(expect.objectContaining({ wait: expect.objectContaining({ durationMs: 5000 }) }));

    rerender(<NodeInspector node={MEMORY_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("最多参考条数")).toHaveValue(5);
    rerender(<NodeInspector node={LOOP_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("列表数据")).toHaveValue("input.items");
  });

  it("等待外部消息节点可以编辑并校验消息字段契约", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={EVENT_WAIT_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    const editor = screen.getByLabelText("消息字段契约");

    fireEvent.change(editor, { target: { value: "[]" } });
    await user.click(screen.getByRole("button", { name: "应用字段契约" }));
    expect(screen.getByRole("alert")).toHaveTextContent("字段契约不是有效的 JSON 对象");
    expect(onNodeChange).not.toHaveBeenCalled();

    const schema = { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } } };
    fireEvent.change(editor, { target: { value: JSON.stringify(schema) } });
    await user.click(screen.getByRole("button", { name: "应用字段契约" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      wait: expect.objectContaining({ payloadSchema: schema }),
    }));
  });

  it("保存经验时从业务步骤选择内容来源", async () => {
    const writeNode = WorkflowNode.parse({ id: "memory_write", title: "保存经验", type: "memory", memory: { mode: "write", contentFrom: "run_summary" } });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector
      node={writeNode}
      workflowNodes={{ [AI_NODE.id]: AI_NODE, [writeNode.id]: writeNode }}
      onNodeChange={onNodeChange}
      onNodeDelete={vi.fn()}
    />);
    expect(screen.getByRole("option", { name: "生成回复方案" })).toHaveValue(AI_NODE.id);
    await user.selectOptions(screen.getByLabelText("保存内容来源"), AI_NODE.id);
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ memory: { mode: "write", contentFrom: AI_NODE.id } }));
  });

  it("并行节点可以修改策略、工作名称并添加步骤", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={PARALLEL_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("并行完成方式"), "any");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ parallel: expect.objectContaining({ strategy: "any" }) }));
    fireEvent.change(screen.getByLabelText("并行工作 1 名称"), { target: { value: "准备正式合同" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ parallel: expect.objectContaining({ branches: expect.arrayContaining([expect.objectContaining({ label: "准备正式合同" })]) }) }));
    await user.click(screen.getAllByRole("button", { name: "添加步骤" })[0]);
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ parallel: expect.objectContaining({ branches: [expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ type: "ai" })]) }), expect.anything()] }) }));
  });

  it("顺序步骤组可以修改名称、输出和内部步骤", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={SUBFLOW_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("步骤组名称"), { target: { value: "正式交付准备" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ subflow: expect.objectContaining({ name: "正式交付准备" }) }));
    fireEvent.change(screen.getByLabelText("步骤组输出"), { target: { value: "合同\n报价" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ subflow: expect.objectContaining({ outputs: ["合同", "报价"] }) }));
    await user.click(screen.getByRole("button", { name: "添加步骤" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ subflow: expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ title: "处理下一步" })]) }) }));
  });

  it("知识节点可以单独修改检索内容", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={KNOWLEDGE_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("检索内容"), { target: { value: "海蓝灯塔二四" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      knowledge: { space: "业务资料库", query: "海蓝灯塔二四" },
    }));
  });

  it("助手调用节点可选择已发布助手并冻结版本契约", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector
      node={AGENT_CALL_NODE}
      agentTargets={[{
        agentId: "00000000-0000-4000-8000-000000000011",
        agentName: "研究助手",
        versionId: "00000000-0000-4000-8000-000000000012",
        version: 3,
        inputContract: { fields: [{ name: "brief" }] },
        outputContract: { fields: [{ path: "result" }] },
      }]}
      onNodeChange={onNodeChange}
      onNodeDelete={vi.fn()}
    />);
    await user.selectOptions(screen.getByLabelText("协作助手"), "00000000-0000-4000-8000-000000000012");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      agentCall: expect.objectContaining({
        targetAgentName: "研究助手",
        versionId: "00000000-0000-4000-8000-000000000012",
        inputContract: { fields: [{ name: "brief" }] },
      }),
    }));
  });

  it("助手交接节点冻结版本、交付物和敏感信息边界", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector
      node={HANDOFF_NODE}
      agentTargets={[{
        agentId: "00000000-0000-4000-8000-000000000021",
        agentName: "履约助手",
        versionId: "00000000-0000-4000-8000-000000000022",
        version: 2,
        inputContract: { fields: [{ name: "brief", label: "任务说明", type: "string" }] },
        outputContract: { fields: [{ path: "result", label: "履约结果" }] },
      }]}
      onNodeChange={onNodeChange}
      onNodeDelete={vi.fn()}
    />);
    await user.selectOptions(screen.getByLabelText("接收助手"), "00000000-0000-4000-8000-000000000022");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      toAgent: { id: "00000000-0000-4000-8000-000000000021", name: "履约助手", versionId: "00000000-0000-4000-8000-000000000022" },
      contract: expect.objectContaining({
        deliverables: ["履约结果"],
        mustNotInclude: expect.arrayContaining(["密钥和访问令牌"]),
        inputSchema: [expect.objectContaining({ name: "brief" })],
        outputSchema: [expect.objectContaining({ name: "result" })],
      }),
    }));
  });

  it("起点节点不提供删除，其余节点点击删除时回调携带节点标识", async () => {
    const onDeleteAi = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <NodeInspector node={AI_NODE} onNodeChange={vi.fn()} onNodeDelete={onDeleteAi} />,
    );
    await user.click(screen.getByRole("button", { name: "删除节点" }));
    expect(onDeleteAi).toHaveBeenCalledWith("step_1");

    const onStart = vi.fn();
    const startNode = WorkflowNode.parse({ id: "start", title: "收到业务任务", type: "trigger" });
    rerender(<NodeInspector node={startNode} onNodeChange={vi.fn()} onNodeDelete={onStart} />);
    expect(screen.queryByRole("button", { name: "删除节点" })).not.toBeInTheDocument();
  });
});
