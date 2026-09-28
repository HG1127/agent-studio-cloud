"use client";

import { Handle, Position, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import {
  AlarmClock, BookOpen, Bot, Braces, BrainCircuit, Check, GitBranch, Handshake,
  ListRestart, Network, Repeat2, Send, Sparkles, UserCheck, Wrench, type LucideIcon,
} from "lucide-react";
import type { WorkflowNode, WorkflowNodeType } from "@/contracts/workflow";
import { supportsErrorRoute } from "./flow-edges";
import { recordedBusinessObjective } from "./business-evidence";

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
  trigger: "bg-emerald-50 text-emerald-700",
  end: "bg-slate-100 text-slate-700",
  ai: "bg-violet-50 text-violet-700",
  human: "bg-amber-50 text-amber-700",
  tool: "bg-sky-50 text-sky-700",
  knowledge: "bg-teal-50 text-teal-700",
  condition: "bg-blue-50 text-blue-700",
  system: "bg-slate-100 text-slate-600",
  rule: "bg-rose-50 text-rose-700",
  loop: "bg-indigo-50 text-indigo-700",
  parallel: "bg-fuchsia-50 text-fuchsia-700",
  wait: "bg-cyan-50 text-cyan-700",
  memory: "bg-lime-50 text-lime-700",
  subflow: "bg-purple-50 text-purple-700",
  agent_call: "bg-blue-50 text-blue-700",
  handoff: "bg-orange-50 text-orange-700",
};

const NODE_TYPE_ICONS: Record<WorkflowNodeType, LucideIcon> = {
  trigger: AlarmClock,
  end: Check,
  ai: Sparkles,
  human: UserCheck,
  tool: Wrench,
  knowledge: BookOpen,
  condition: GitBranch,
  system: Braces,
  rule: ListRestart,
  loop: Repeat2,
  parallel: Network,
  wait: AlarmClock,
  memory: BrainCircuit,
  subflow: Network,
  agent_call: Bot,
  handoff: Handshake,
};

export type WorkflowFlowNodeData = { node: WorkflowNode };
export type WorkflowFlowNode = Node<WorkflowFlowNodeData>;

const HANDLE_STYLE = { width: 9, height: 9, background: "#e5e7eb", border: "1px solid #6b7280" } as const;

function isToolUnbound(node: WorkflowNode): boolean {
  return node.type === "tool" && (Boolean(node.tool?.unresolved) || !node.tool?.registryToolId);
}

// 演示绑定（registryToolId/protocol 为 demo）的工具节点明确标注「演示」；
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
  const NodeIcon = NODE_TYPE_ICONS[node.type] ?? Send;
  const businessObjective = recordedBusinessObjective(node);
  const plainNextVisible = isCondition || isLoop ? Boolean(node.next) : node.type !== "end";
  const targetVisible = !isTrigger;

  return (
    <div
      className={`min-w-[190px] max-w-[230px] rounded-xl border bg-white px-3 py-2.5 shadow-sm transition-shadow ${
        props.selected ? "border-indigo-500 ring-2 ring-indigo-100 shadow-md" : isTrigger ? "border-emerald-400" : "border-slate-200"
      }`}
    >
      {targetVisible ? <Handle id="in" type="target" position={Position.Left} style={HANDLE_STYLE} /> : null}
      {plainNextVisible ? (
        <Handle id="next" type="source" position={Position.Right} style={HANDLE_STYLE} title="正常流转" />
      ) : null}
      {node.type === "human" ? (
        <Handle id="reject" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "78%" }} title="不通过" />
      ) : null}
      {supportsErrorRoute(node) ? (
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
      {node.type === "wait" && node.wait?.mode === "event" && node.wait.timeoutMs > 0 ? (
        <Handle id="timeout" type="source" position={Position.Right} style={{ ...HANDLE_STYLE, top: "78%" }} title="等待超时" />
      ) : null}

      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${NODE_TYPE_BADGES[node.type]}`}
        >
          <NodeIcon className="size-3.5" />
        </span>
        <span className="text-xs font-medium text-slate-500">{NODE_TYPE_LABELS[node.type]}</span>
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
      {businessObjective && businessObjective !== node.title && businessObjective !== node.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-indigo-800">业务目标：{businessObjective}</p> : null}
      {node.description ? <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{node.description}</p> : null}
    </div>
  );
}

export const workflowNodeTypes: NodeTypes = Object.fromEntries(
  (Object.keys(NODE_TYPE_LABELS) as WorkflowNodeType[]).map((type) => [type, WorkflowNodeView]),
) as NodeTypes;
