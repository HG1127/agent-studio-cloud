"use client";

import { Handle, Position, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import type { WorkflowNode, WorkflowNodeType } from "@/contracts/workflow";

// 中文标签沿用旧系统画布的叫法，用户看到的类型名与旧版一致
export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
  trigger: "启动",
  end: "完成",
  ai: "智能处理",
  human: "员工确认",
  tool: "操作业务系统",
  knowledge: "读取资料",
  condition: "分情况处理",
  system: "自动记录",
  rule: "按规则检查",
  loop: "逐项处理",
  parallel: "同时处理",
  wait: "等待后继续",
  memory: "参考经验",
  subflow: "一组步骤",
  agent_call: "呼叫其他助手",
  handoff: "交给其他助手",
};

const NODE_TYPE_BADGES: Record<WorkflowNodeType, string> = {
  trigger: "bg-emerald-600",
  end: "bg-gray-700",
  ai: "bg-violet-600",
  human: "bg-amber-500",
  tool: "bg-sky-600",
  knowledge: "bg-teal-600",
  condition: "bg-blue-600",
  system: "bg-slate-500",
  rule: "bg-rose-500",
  loop: "bg-indigo-600",
  parallel: "bg-fuchsia-600",
  wait: "bg-cyan-600",
  memory: "bg-lime-600",
  subflow: "bg-purple-600",
  agent_call: "bg-blue-500",
  handoff: "bg-orange-500",
};

export type WorkflowFlowNodeData = { node: WorkflowNode };
export type WorkflowFlowNode = Node<WorkflowFlowNodeData>;

const HANDLE_STYLE = { width: 9, height: 9, background: "#e5e7eb", border: "1px solid #6b7280" } as const;

function isToolUnbound(node: WorkflowNode): boolean {
  return node.type === "tool" && (Boolean(node.tool?.unresolved) || !node.tool?.registryToolId);
}

// M1 演示发布策略的画布标识：演示绑定（registryToolId/protocol 为 demo）的工具节点标注「演示」；
// 未绑定判定保留在前，真正未绑定的节点仍显示「未绑定工具」
function isDemoTool(node: WorkflowNode): boolean {
  return node.type === "tool" && (node.tool?.registryToolId === "demo" || node.tool?.protocol === "demo");
}

// 出边句柄与草稿字段一一对应：next/reject/error/default/body/exit/timeout/branch-N
export function WorkflowNodeView(props: NodeProps) {
  const node = (props.data as WorkflowFlowNodeData).node;
  const isTrigger = node.type === "trigger";
  const isCondition = node.type === "condition";
  const isLoop = node.type === "loop";
  const branchCount = node.condition?.branches.length ?? 0;
  const plainNextVisible = isCondition || isLoop ? Boolean(node.next) : node.type !== "end";
  const targetVisible = !isTrigger;

  return (
    <div
      className={`min-w-[190px] max-w-[230px] rounded-lg border bg-white px-3 py-2 shadow-sm ${
        isTrigger ? "border-emerald-500" : "border-gray-200"
      }`}
    >
      {targetVisible ? <Handle id="in" type="target" position={Position.Left} style={HANDLE_STYLE} /> : null}
      {plainNextVisible ? (
        <Handle id="next" type="source" position={Position.Right} style={HANDLE_STYLE} title="正常流转" />
      ) : null}
      {node.type === "human" ? (
        <Handle id="reject" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "78%" }} title="不通过" />
      ) : null}
      {node.type === "ai" || node.type === "tool" ? (
        <Handle id="error" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "78%" }} title="未完成时" />
      ) : null}
      {node.type === "wait" && node.wait?.mode === "event" ? (
        <Handle id="timeout" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "78%" }} title="超时后" />
      ) : null}
      {isCondition
        ? node.condition?.branches.map((branch, index) => (
            <Handle
              key={`branch-${index}`}
              id={`branch-${index}`}
              type="source"
              position={Position.Right}
              style={{ ...HANDLE_STYLE, top: `${((index + 1) / (branchCount + 2)) * 100}%` }}
              title={branch.label || "分支"}
            />
          ))
        : null}
      {isCondition ? (
        <Handle
          id="default"
          type="source"
          position={Position.Right}
          style={{ ...HANDLE_STYLE, top: `${((branchCount + 1) / (branchCount + 2)) * 100}%` }}
          title="其余情况"
        />
      ) : null}
      {isLoop ? (
        <>
          <Handle id="body" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "35%" }} title="逐项处理" />
          <Handle id="exit" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "78%" }} title="完成" />
        </>
      ) : null}

      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white ${NODE_TYPE_BADGES[node.type]}`}
        >
          {NODE_TYPE_LABELS[node.type].slice(0, 1)}
        </span>
        <span className="text-xs text-gray-400">{NODE_TYPE_LABELS[node.type]}</span>
        {node.type === "human" ? (
          <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
            {node.approval?.role || "业务负责人"}
          </span>
        ) : null}
        {isToolUnbound(node) ? (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">未绑定工具</span>
        ) : isDemoTool(node) ? (
          <span className="ml-auto rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-700">演示</span>
        ) : null}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug text-gray-900">{node.title}</p>
      {node.description ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{node.description}</p> : null}
    </div>
  );
}

export const workflowNodeTypes: NodeTypes = Object.fromEntries(
  (Object.keys(NODE_TYPE_LABELS) as WorkflowNodeType[]).map((type) => [type, WorkflowNodeView]),
) as NodeTypes;
