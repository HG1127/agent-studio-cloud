import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { MAX_WAIT_DURATION_MS, WorkflowNode } from "@/contracts/workflow";
import { fromDateTimeLocalValue, NodeInspector, parseConditionValue, toDateTimeLocalValue } from "@/features/workflow-canvas/NodeInspector";

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
const KNOWLEDGE_SOURCE = {
  id: "00000000-0000-4000-8000-000000000041",
  name: "退款规则.md",
  mime: "text/markdown",
  sizeBytes: 100,
  status: "indexed" as const,
  chunkCount: 1,
  charCount: 80,
  error: null,
  hasOriginal: false,
  createdAt: "2026-09-25T00:00:00.000Z",
};
const TOOL_NODE = WorkflowNode.parse({
  id: "tool_1", title: "更新客户资料", type: "tool",
  tool: { connector: "demo", action: "update_customer", scope: "demo", risk: "low", maxRetries: 1, registryToolId: "demo", protocol: "demo" },
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
const COLLABORATION_TARGET = AgentTargetOption.parse({
  agentId: "00000000-0000-4000-8000-000000000021",
  agentName: "研究助手",
  versionId: "00000000-0000-4000-8000-000000000022",
  version: 2,
  inputContract: { fields: [{ name: "brief", label: "任务说明", type: "string", required: true }] },
  outputContract: { fields: [{ path: "report", label: "研究报告", required: true, sourceNodeId: "draft" }] },
});

describe("NodeInspector", () => {
  it("仅在单一路径可换序时开放步骤顺序按钮", async () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={AI_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()}
      canMoveUp={false} canMoveDown onMoveUp={onMoveUp} onMoveDown={onMoveDown} />);
    expect(screen.getByRole("button", { name: "上移步骤" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "下移步骤" }));
    expect(onMoveDown).toHaveBeenCalledOnce();
    expect(onMoveUp).not.toHaveBeenCalled();
  });
  it("按草稿真实业务规格展示需求证据、完成标准与缺失来源", () => {
    const node = WorkflowNode.parse({
      ...AI_NODE,
      businessSpec: {
        objective: "核对客户续约条件",
        evidence: ["用户要求先核对续约资格"],
        inputs: [{ path: "input.customer", label: "客户资料" }],
        rules: ["合同到期前处理"],
        outputs: ["续约资格结论"],
        doneWhen: ["输出资格结论与核对依据"],
        grounding: { status: "grounded", score: 0.82 },
        executability: {
          status: "blocked",
          sources: [{ kind: "runtime-input", label: "客户资料", verified: true }],
          missingSources: [{ kind: "data_source", question: "续约记录从哪里读取？", detail: "未绑定资料源" }],
        },
      },
    });
    render(<NodeInspector node={node} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);

    const card = within(screen.getByRole("region", { name: "业务依据与完成标准" }));
    expect(card.getByText("草稿已关联需求")).toBeVisible();
    expect(card.getByText("设计时来源检查受阻")).toBeVisible();
    expect(card.getByText("用户要求先核对续约资格")).toBeVisible();
    expect(card.getByText("客户资料")).toBeVisible();
    expect(card.getByText("输出资格结论与核对依据")).toBeVisible();
    expect(card.getByText("续约记录从哪里读取？")).toBeVisible();
    expect(card.queryByText("未绑定资料源")).not.toBeInTheDocument();
  });

  it("缺少业务规格时提示补证据，不把节点标题当作需求依据", () => {
    render(<NodeInspector node={AI_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    const card = within(screen.getByRole("region", { name: "业务依据与完成标准" }));
    expect(card.getByRole("status")).toHaveTextContent("还没有业务规格");
    expect(card.queryByText("生成回复方案")).not.toBeInTheDocument();
  });

  it("设计时来源检查通过也不把未记录的额外来源冒充为实际可用", () => {
    const node = WorkflowNode.parse({
      ...AI_NODE,
      businessSpec: {
        objective: "生成回复方案",
        evidence: ["用户要求生成回复方案"],
        doneWhen: ["生成可供人工确认的回复文本"],
        grounding: { status: "execution-grounded" },
        executability: { status: "executable", sources: [] },
      },
    });
    render(<NodeInspector node={node} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    const card = within(screen.getByRole("region", { name: "业务依据与完成标准" }));
    expect(card.getByText("草稿有执行契约依据")).toBeVisible();
    expect(card.getByText("设计时来源检查通过")).toBeVisible();
    expect(card.getByText("未记录额外来源")).toBeVisible();
    expect(card.queryByText("实际来源已验证")).not.toBeInTheDocument();
  });

  it("平台控制节点不展示业务依据卡片", () => {
    const node = WorkflowNode.parse({ ...AI_NODE, ui: { visibility: "control" } });
    render(<NodeInspector node={node} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "业务依据与完成标准" })).not.toBeInTheDocument();
  });

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

  it("条件分支可以配置全部或任一满足的复合条件", async () => {
    const compoundNode = WorkflowNode.parse({
      ...CONDITION_NODE,
      condition: {
        ...CONDITION_NODE.condition!,
        branches: [{ label: "重点订单", value: "high", next: null }],
      },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<NodeInspector node={compoundNode} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "添加并列条件" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      condition: expect.objectContaining({ branches: [expect.objectContaining({
        mode: "all",
        rules: [{ source: "input.amount", operator: "eq", value: "high" }],
      })] }),
    }));

    const configured = WorkflowNode.parse({
      ...compoundNode,
      condition: {
        ...compoundNode.condition!,
        branches: [{
          label: "重点订单",
          next: null,
          mode: "all",
          rules: [{ source: "input.amount", operator: "gte", value: 1000 }],
        }],
      },
    });
    onNodeChange.mockClear();
    rerender(<NodeInspector node={configured} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("情况 1 条件组合"), "any");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      condition: expect.objectContaining({ branches: [expect.objectContaining({ mode: "any" })] }),
    }));
    await user.click(screen.getAllByRole("button", { name: "添加条件" }).at(-1)!);
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      condition: expect.objectContaining({ branches: [expect.objectContaining({ rules: [expect.anything(), { source: "input.", operator: "eq", value: "" }] })] }),
    }));
  });

  it("复合条件展示字段含义并允许删除非唯一条件", async () => {
    const node = WorkflowNode.parse({
      ...CONDITION_NODE,
      condition: { ...CONDITION_NODE.condition!, branches: [{
        label: "重点订单", next: null, mode: "all",
        rules: [
          { source: "input.amount", operator: "gte", value: 1000 },
          { source: "input.status", operator: "eq", value: "待审核" },
        ],
      }] },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={node} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("情况 1 条件 2 数据").closest("label")).toHaveTextContent("判断数据");
    expect(screen.getByLabelText("情况 1 条件 2 判断方式").closest("label")).toHaveTextContent("判断方式");
    expect(screen.getByLabelText("情况 1 条件 2 比较值").closest("label")).toHaveTextContent("比较值");
    await user.click(screen.getByRole("button", { name: "删除情况 1 条件 2" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      condition: expect.objectContaining({ branches: [expect.objectContaining({ rules: [{ source: "input.amount", operator: "gte", value: 1000 }] })] }),
    }));
  });

  it("条件比较值保留数字和布尔类型，普通文字仍按字符串保存", () => {
    expect(parseConditionValue("42")).toBe(42);
    expect(parseConditionValue("true")).toBe(true);
    expect(parseConditionValue("null")).toBeNull();
    expect(parseConditionValue("已完成")).toBe("已完成");
    expect(parseConditionValue('{"unsafe":"object"}')).toBe('{"unsafe":"object"}');
  });

  it("等待、经验和逐项处理节点暴露运行所需设置", () => {
    const onWait = vi.fn();
    const { rerender } = render(<NodeInspector node={WAIT_NODE} onNodeChange={onWait} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("等待秒数"), { target: { value: "5" } });
    expect(onWait).toHaveBeenLastCalledWith(expect.objectContaining({ wait: expect.objectContaining({ durationMs: 5000 }) }));
    fireEvent.change(screen.getByLabelText("等待秒数"), { target: { value: "99999999" } });
    expect(onWait).toHaveBeenLastCalledWith(expect.objectContaining({
      wait: expect.objectContaining({ durationMs: MAX_WAIT_DURATION_MS }),
    }));

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
    fireEvent.change(screen.getByLabelText("消息标识"), { target: { value: "客户 ready!" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ wait: expect.objectContaining({ eventKey: "ready" }) }));
    onNodeChange.mockClear();

    fireEvent.change(editor, { target: { value: "[]" } });
    await user.click(screen.getByRole("button", { name: "应用字段契约" }));
    expect(screen.getByRole("alert")).toHaveTextContent("字段契约不是有效的 JSON 对象");
    expect(onNodeChange).not.toHaveBeenCalled();

    fireEvent.change(editor, { target: { value: JSON.stringify({ type: "object", allOf: [] }) } });
    await user.click(screen.getByRole("button", { name: "应用字段契约" }));
    expect(screen.getByRole("alert")).toHaveTextContent("暂不支持的规则");
    expect(onNodeChange).not.toHaveBeenCalled();

    const schema = { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } } };
    fireEvent.change(editor, { target: { value: JSON.stringify(schema) } });
    await user.click(screen.getByRole("button", { name: "应用字段契约" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      wait: expect.objectContaining({ payloadSchema: schema }),
    }));
  });

  it("指定时间在本地输入值与带时区 ISO 时间之间无损往返", () => {
    const local = "2026-09-25T10:30";
    const stored = fromDateTimeLocalValue(local);
    expect(stored).toMatch(/Z$/);
    expect(toDateTimeLocalValue(stored)).toBe(local);
    expect(fromDateTimeLocalValue("")).toBeNull();
  });

  it("保存经验时从业务步骤选择内容来源", async () => {
    const writeNode = WorkflowNode.parse({ id: "memory_write", title: "保存经验", type: "memory", memory: { mode: "write", contentFrom: "run_summary" } });
    const hiddenNode = WorkflowNode.parse({
      id: "hidden", title: "内部安全收口", type: "system",
      controlPlane: { kind: "safety", hiddenByDefault: true },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector
      node={writeNode}
      workflowNodes={{ [AI_NODE.id]: AI_NODE, [hiddenNode.id]: hiddenNode, [writeNode.id]: writeNode }}
      onNodeChange={onNodeChange}
      onNodeDelete={vi.fn()}
    />);
    expect(screen.getByRole("option", { name: "生成回复方案" })).toHaveValue(AI_NODE.id);
    expect(screen.queryByRole("option", { name: "内部安全收口" })).not.toBeInTheDocument();
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

  it("并行工作删除后再添加不会复用仍存在的标识", async () => {
    const nodeWithGap = WorkflowNode.parse({
      ...PARALLEL_NODE,
      parallel: {
        ...PARALLEL_NODE.parallel!,
        branches: [
          PARALLEL_NODE.parallel!.branches[0],
          { ...PARALLEL_NODE.parallel!.branches[1], id: "branch_3" },
        ],
      },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={nodeWithGap} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "添加并行工作" }));

    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parallel: expect.objectContaining({
        branches: expect.arrayContaining([expect.objectContaining({ id: "branch_4" })]),
      }),
    }));
  });

  it("并行工作可以改为业务工具并绑定服务端工具", async () => {
    const toolParallel = WorkflowNode.parse({
      ...PARALLEL_NODE,
      parallel: {
        ...PARALLEL_NODE.parallel!,
        branches: PARALLEL_NODE.parallel!.branches.map((branch, index) => index === 0 ? {
          ...branch,
          steps: [{ id: "step_1", title: "更新客户", type: "tool", tool: { connector: "demo", action: "demo", scope: "demo", registryToolId: "demo", protocol: "demo" } }],
        } : branch),
      },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={toolParallel} toolOptions={[{
      id: "crm.update", name: "客户系统", description: "", action: "update_customer", scope: "customer.write", risk: "medium",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
    }]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("并行工作 1 步骤 1 业务工具"), "crm.update");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parallel: expect.objectContaining({ branches: [expect.objectContaining({
        steps: [expect.objectContaining({ tool: expect.objectContaining({ registryToolId: "crm.update", protocol: "http-json" }) })],
      }), expect.anything()] }),
    }));
  });

  it("并行工作保留并可配置内嵌助手调用", async () => {
    const collaborationParallel = WorkflowNode.parse({
      ...PARALLEL_NODE,
      parallel: {
        ...PARALLEL_NODE.parallel!,
        branches: PARALLEL_NODE.parallel!.branches.map((branch, index) => index === 0 ? {
          ...branch,
          steps: [{ id: "step_1", title: "调用研究助手", type: "agent_call", agentCall: { targetAgentId: "", versionId: "" } }],
        } : branch),
      },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={collaborationParallel} agentTargets={[COLLABORATION_TARGET]}
      onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    expect(screen.getByLabelText("并行工作 1 步骤 1 类型")).toHaveValue("agent_call");
    await user.selectOptions(screen.getByLabelText("并行工作 1 步骤 1 协作助手"), COLLABORATION_TARGET.versionId);
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parallel: expect.objectContaining({ branches: [expect.objectContaining({
        steps: [expect.objectContaining({ agentCall: expect.objectContaining({
          targetAgentName: "研究助手",
          versionId: COLLABORATION_TARGET.versionId,
          inputContract: COLLABORATION_TARGET.inputContract,
          outputContract: COLLABORATION_TARGET.outputContract,
        }) })],
      }), expect.anything()] }),
    }));
    onNodeChange.mockClear();
    await user.selectOptions(screen.getByLabelText("并行工作 1 步骤 1 经验共享范围"), "team");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parallel: expect.objectContaining({ branches: [expect.objectContaining({
        steps: [expect.objectContaining({ agentCall: expect.objectContaining({ memoryAccess: { mode: "team" } }) })],
      }), expect.anything()] }),
    }));
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

  it("步骤组展示内部字段含义并允许删除新增步骤", async () => {
    const node = WorkflowNode.parse({
      ...SUBFLOW_NODE,
      subflow: { ...SUBFLOW_NODE.subflow!, steps: [
        { id: "step_1", title: "检查材料", type: "ai" },
        { id: "step_2", title: "核对资料", type: "ai" },
      ] },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={node} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("步骤组步骤 2 类型").closest("label")).toHaveTextContent("处理类型");
    expect(screen.getByLabelText("步骤组步骤 2 名称").closest("label")).toHaveTextContent("步骤名称");
    expect(screen.getByLabelText("步骤组步骤 2 说明").closest("label")).toHaveTextContent("步骤说明");
    await user.click(screen.getByRole("button", { name: "删除步骤组步骤 2" }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      subflow: expect.objectContaining({ steps: [expect.objectContaining({ id: "step_1" })] }),
    }));
  });

  it("顺序步骤组可以创建资料和经验步骤", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={SUBFLOW_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("步骤组步骤 1 类型"), "knowledge");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      subflow: expect.objectContaining({ steps: [expect.objectContaining({ type: "knowledge", knowledge: { space: "业务资料库", query: "" } })] }),
    }));
  });

  it("步骤组中的资料步骤也可以限制资料范围", async () => {
    const knowledgeSubflow = WorkflowNode.parse({
      ...SUBFLOW_NODE,
      subflow: {
        ...SUBFLOW_NODE.subflow!,
        steps: [{ id: "step_1", title: "查询规则", type: "knowledge", knowledge: { space: "业务资料库", query: "" } }],
      },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={knowledgeSubflow} knowledgeSources={[KNOWLEDGE_SOURCE]}
      onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    await user.click(screen.getByRole("checkbox", { name: KNOWLEDGE_SOURCE.name }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      subflow: expect.objectContaining({
        steps: [expect.objectContaining({ knowledge: expect.objectContaining({ sourceIds: [KNOWLEDGE_SOURCE.id] }) })],
      }),
    }));
  });

  it("顺序步骤组可配置内嵌助手交接并冻结交付契约", async () => {
    const handoffSubflow = WorkflowNode.parse({
      ...SUBFLOW_NODE,
      subflow: {
        ...SUBFLOW_NODE.subflow!,
        steps: [{ id: "step_1", title: "交给研究助手", type: "handoff", toAgent: { id: "", versionId: "" } }],
      },
    });
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={handoffSubflow} agentTargets={[COLLABORATION_TARGET]}
      onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    expect(screen.getByLabelText("步骤组步骤 1 类型")).toHaveValue("handoff");
    await user.selectOptions(screen.getByLabelText("步骤组步骤 1 接收助手"), COLLABORATION_TARGET.versionId);
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      subflow: expect.objectContaining({ steps: [expect.objectContaining({
        toAgent: expect.objectContaining({ name: "研究助手", versionId: COLLABORATION_TARGET.versionId }),
        contract: expect.objectContaining({
          deliverables: ["研究报告"],
          inputSchema: [expect.objectContaining({ name: "brief" })],
          outputSchema: [expect.objectContaining({ name: "report" })],
        }),
      })] }),
    }));
  });

  it("知识节点可以修改检索内容并选择发布资料范围", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={KNOWLEDGE_NODE} knowledgeSources={[KNOWLEDGE_SOURCE]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("检索内容"), { target: { value: "海蓝灯塔二四" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      knowledge: { space: "业务资料库", query: "海蓝灯塔二四" },
    }));
    onNodeChange.mockClear();
    await user.click(screen.getByRole("checkbox", { name: KNOWLEDGE_SOURCE.name }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      knowledge: expect.objectContaining({ sourceIds: [KNOWLEDGE_SOURCE.id] }),
    }));
  });

  it("导入资料失效时要求重新确认，选择后解除发布阻止", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    const imported = WorkflowNode.parse({
      ...KNOWLEDGE_NODE,
      knowledge: { ...KNOWLEDGE_NODE.knowledge!, sourceIds: [], selectionRequired: true },
    });
    render(<NodeInspector node={imported} knowledgeSources={[KNOWLEDGE_SOURCE]}
      onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    expect(screen.getByText("导入文件中的资料不属于当前工作区，请重新选择资料范围。")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "全部已入库资料" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: KNOWLEDGE_SOURCE.name }));
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      knowledge: expect.objectContaining({ sourceIds: [KNOWLEDGE_SOURCE.id], selectionRequired: false }),
    }));
  });

  it("工具节点可以选择服务端业务工具并冻结回执契约", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector
      node={TOOL_NODE}
      toolOptions={[{
        id: "crm.update", name: "客户系统", description: "更新客户跟进状态", action: "update_customer",
        scope: "customer.write", risk: "medium", inputSchema: { type: "object" },
        outputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
      }]}
      onNodeChange={onNodeChange}
      onNodeDelete={vi.fn()}
    />);
    await user.selectOptions(screen.getByLabelText("业务工具"), "crm.update");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tool: expect.objectContaining({
        registryToolId: "crm.update", protocol: "http-json", connector: "客户系统",
        outputSchema: expect.objectContaining({ required: ["receiptId"] }),
      }),
    }));
  });

  it("导入工具失效时要求重新选择且不降级成演示成功", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    const unavailable = WorkflowNode.parse({
      ...TOOL_NODE,
      tool: {
        ...TOOL_NODE.tool!,
        registryToolId: null,
        protocol: "unbound",
        unresolved: true,
      },
    });
    const option = {
      id: "crm.update", name: "客户系统", description: "更新客户跟进状态", action: "update_customer",
      scope: "customer.write", risk: "medium" as const, inputSchema: { type: "object" }, outputSchema: { type: "object" },
    };
    render(<NodeInspector node={unavailable} toolOptions={[option]}
      onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);

    expect(screen.getByText("原业务工具在当前服务端不可用，请重新选择。保存前不会自动替换原绑定。")).toBeVisible();
    expect(screen.getByLabelText("业务工具")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("业务工具"), option.id);
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tool: expect.objectContaining({ registryToolId: option.id, unresolved: false }),
    }));
  });

  it("服务端清单已移除的旧绑定显示明确状态，选择新工具前不改草稿", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    const stale = WorkflowNode.parse({ ...TOOL_NODE, tool: { ...TOOL_NODE.tool!, connector: "原客户系统", registryToolId: "gone.tool", protocol: "http-json", unresolved: false } });
    render(<NodeInspector node={stale} toolOptions={[{
      id: "crm.update", name: "客户系统", description: "", action: "update_customer", scope: "customer.write", risk: "medium",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
    }]} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "业务工具" })).toHaveValue("gone.tool");
    expect(screen.getByRole("option", { name: "原工具当前不可用（请重新选择）" })).toBeVisible();
    expect(screen.getByText("原业务工具在当前服务端不可用，请重新选择。保存前不会自动替换原绑定。")).toBeVisible();
    expect(onNodeChange).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole("combobox", { name: "业务工具" }), "crm.update");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ tool: expect.objectContaining({ registryToolId: "crm.update", unresolved: false }) }));
  });

  it("新业务工具保持未绑定，只有明确选择演示工具才启用演示配置", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    const unbound = WorkflowNode.parse({
      ...TOOL_NODE,
      tool: { ...TOOL_NODE.tool!, connector: "unbound", action: "", scope: "", registryToolId: null, protocol: "unbound", unresolved: true },
    });
    render(<NodeInspector node={unbound} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("业务工具")).toHaveValue("");
    expect(screen.getByText(/尚未绑定可用的业务工具/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText("业务工具"), "demo");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      tool: expect.objectContaining({ registryToolId: "demo", protocol: "demo", unresolved: false }),
    }));
  });

  it("既有演示工具在节点详情持续说明不会执行真实业务操作", () => {
    render(<NodeInspector node={TOOL_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    expect(screen.getByText("当前是演示工具，不会连接业务系统或执行真实业务操作。")).toBeVisible();
  });

  it("内嵌步骤切换为业务工具时也先保持未绑定", async () => {
    const onNodeChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={PARALLEL_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("并行工作 1 步骤 1 类型"), "tool");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parallel: expect.objectContaining({ branches: [expect.objectContaining({
        steps: [expect.objectContaining({ tool: expect.objectContaining({ registryToolId: null, protocol: "unbound", unresolved: true }) })],
      }), expect.anything()] }),
    }));
  });

  it("工具节点可以设置总尝试次数与失败等待时间", () => {
    const onNodeChange = vi.fn();
    const { rerender } = render(<NodeInspector node={TOOL_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("最多尝试次数"), { target: { value: "4" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ retry: { maxAttempts: 4, backoffMs: 5_000 } }));

    const configured = WorkflowNode.parse({ ...TOOL_NODE, retry: { maxAttempts: 4, backoffMs: 5_000 } });
    rerender(<NodeInspector node={configured} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("失败后等待秒数"), { target: { value: "1.25" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ retry: { maxAttempts: 4, backoffMs: 1_250 } }));
  });

  it("内嵌工具步骤也可以设置重试策略", () => {
    const toolParallel = WorkflowNode.parse({
      ...PARALLEL_NODE,
      parallel: {
        ...PARALLEL_NODE.parallel!,
        branches: PARALLEL_NODE.parallel!.branches.map((branch, index) => index === 0 ? {
          ...branch,
          steps: [{ id: "step_1", title: "更新客户", type: "tool", tool: { connector: "demo", action: "demo", scope: "demo", registryToolId: "demo", protocol: "demo" } }],
        } : branch),
      },
    });
    const onNodeChange = vi.fn();
    render(<NodeInspector node={toolParallel} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("并行工作 1 步骤 1 最多尝试次数"), { target: { value: "3" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      parallel: expect.objectContaining({ branches: [expect.objectContaining({
        steps: [expect.objectContaining({ retry: { maxAttempts: 3, backoffMs: 5_000 } })],
      }), expect.anything()] }),
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
        inputContract: { fields: [{ name: "brief", type: "string", required: true }] },
        outputContract: { fields: [{ path: "result", required: true }] },
      }]}
      onNodeChange={onNodeChange}
      onNodeDelete={vi.fn()}
    />);
    await user.selectOptions(screen.getByLabelText("协作助手"), "00000000-0000-4000-8000-000000000012");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      agentCall: expect.objectContaining({
        targetAgentName: "研究助手",
        versionId: "00000000-0000-4000-8000-000000000012",
        inputContract: { fields: [{ name: "brief", type: "string", required: true }] },
      }),
    }));
    onNodeChange.mockClear();
    await user.selectOptions(screen.getByLabelText("经验共享范围"), "self");
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      agentCall: expect.objectContaining({ memoryAccess: { mode: "self" } }),
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
        inputContract: { fields: [{ name: "brief", label: "任务说明", type: "string", required: true }] },
        outputContract: { fields: [{ path: "result", label: "履约结果", required: true }] },
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
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "删除节点" }).at(-1)!);
    expect(onDeleteAi).toHaveBeenCalledWith("step_1");

    const onStart = vi.fn();
    const startNode = WorkflowNode.parse({ id: "start", title: "收到业务任务", type: "trigger" });
    rerender(<NodeInspector node={startNode} onNodeChange={vi.fn()} onNodeDelete={onStart} />);
    expect(screen.queryByRole("button", { name: "删除节点" })).not.toBeInTheDocument();
  });

  it("可以关闭节点详情而不改动流程", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NodeInspector node={AI_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "关闭节点详情" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
