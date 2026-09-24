"use client";

import type { AgentTargetOption } from "@/contracts/agent";
import type { WorkflowNode } from "@/contracts/workflow";
import { NODE_TYPE_LABELS } from "./CustomNodes";

interface NodeInspectorProps {
  node: WorkflowNode;
  agentTargets?: AgentTargetOption[];
  onNodeChange: (node: WorkflowNode) => void;
  onNodeDelete: (nodeId: string) => void;
}

const DEFAULT_HANDOFF_PROHIBITED = ["密钥和访问令牌", "与本次任务无关的个人隐私", "未确认的内部草稿"];

function contractFields(contract: Record<string, unknown>, key: "name" | "path") {
  const fields = Array.isArray(contract.fields) ? contract.fields : [];
  return fields.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const name = String(row[key] || row.name || row.path || "").trim();
    if (!name) return [];
    const rawType = String(row.type || "any");
    const type = (["string", "number", "boolean", "object", "array", "any"] as string[]).includes(rawType) ? rawType : "any";
    return [{ name, label: String(row.label || name), type: type as "string" | "number" | "boolean" | "object" | "array" | "any", required: row.required !== false }];
  });
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
}

// M1 编辑范围：title/description，加 human 的负责人与确认事项；condition 的说明以「判断说明」呈现
export function NodeInspector({ node, agentTargets = [], onNodeChange, onNodeDelete }: NodeInspectorProps) {
  const isHuman = node.type === "human";
  const isCondition = node.type === "condition";
  const knowledge = node.knowledge;
  const deletable = node.type !== "trigger" && node.type !== "end";
  return (
    <aside aria-label="节点详情" className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{NODE_TYPE_LABELS[node.type]}</span>
        <h2 className="text-sm font-semibold text-gray-900">节点详情</h2>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="node-title" className="text-sm font-medium">
          节点名称
        </label>
        <input
          id="node-title"
          value={node.title}
          maxLength={60}
          onChange={(event) => onNodeChange({ ...node, title: event.target.value })}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="node-description" className="text-sm font-medium">
          {isCondition ? "判断说明" : "说明"}
        </label>
        <textarea
          id="node-description"
          value={node.description ?? ""}
          rows={3}
          maxLength={500}
          onChange={(event) => onNodeChange({ ...node, description: event.target.value })}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
      </div>
      {node.type === "knowledge" && knowledge ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="node-query" className="text-sm font-medium">检索内容</label>
          <input
            id="node-query"
            value={knowledge.query ?? ""}
            maxLength={200}
            onChange={(event) => onNodeChange({ ...node, knowledge: { ...knowledge, query: event.target.value } })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          />
        </div>
      ) : null}
      {isHuman ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="node-role" className="text-sm font-medium">
              负责人
            </label>
            <input
              id="node-role"
              value={node.approval?.role ?? ""}
              maxLength={30}
              onChange={(event) =>
                onNodeChange({
                  ...node,
                  approval: { role: event.target.value, reason: node.approval?.reason ?? "" },
                })
              }
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="node-reason" className="text-sm font-medium">
              确认事项
            </label>
            <input
              id="node-reason"
              value={node.approval?.reason ?? ""}
              maxLength={200}
              onChange={(event) =>
                onNodeChange({
                  ...node,
                  approval: { role: node.approval?.role ?? "业务负责人", reason: event.target.value },
                })
              }
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
        </>
      ) : null}
      {node.type === "agent_call" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="node-agent-target" className="text-sm font-medium">协作助手</label>
          <select
            id="node-agent-target"
            value={node.agentCall?.versionId ?? ""}
            onChange={(event) => {
              const target = agentTargets.find((item) => item.versionId === event.target.value);
              onNodeChange({
                ...node,
                agentCall: target ? {
                  targetAgentId: target.agentId,
                  targetAgentName: target.agentName,
                  versionId: target.versionId,
                  workflowId: target.versionId,
                  memoryAccess: { mode: "none" },
                  inputContract: target.inputContract,
                  outputContract: target.outputContract,
                } : { targetAgentId: "", versionId: "" },
              });
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">请选择已发布助手</option>
            {agentTargets.map((target) => (
              <option key={target.versionId} value={target.versionId}>{target.agentName}（版本 {target.version}）</option>
            ))}
          </select>
          {agentTargets.length === 0 ? <p className="text-xs text-gray-500">还没有其他已发布助手可供选择</p> : null}
        </div>
      ) : null}
      {node.type === "handoff" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="node-handoff-target" className="text-sm font-medium">接收助手</label>
            <select
              id="node-handoff-target"
              value={node.toAgent?.versionId ?? ""}
              onChange={(event) => {
                const target = agentTargets.find((item) => item.versionId === event.target.value);
                const outputFields = target ? contractFields(target.outputContract, "path") : [];
                const inputFields = target ? contractFields(target.inputContract, "name") : [];
                onNodeChange({
                  ...node,
                  toAgent: target ? { id: target.agentId, name: target.agentName, versionId: target.versionId } : { id: "", versionId: "" },
                  contract: target ? {
                    deliverables: outputFields.map((field) => field.label || field.name).length > 0
                      ? outputFields.map((field) => field.label || field.name)
                      : ["完成交接任务并返回可核对的结果"],
                    mustNotInclude: DEFAULT_HANDOFF_PROHIBITED,
                    inputSchema: inputFields.length > 0 ? inputFields : [{ name: "brief", label: "交接说明", type: "string", required: true }],
                    outputSchema: outputFields.length > 0 ? outputFields : [{ name: "result", label: "交接结果", type: "any", required: true }],
                    memoryPolicy: { mode: "none", shared: [], private: ["密钥", "个人隐私", "内部草稿"] },
                  } : undefined,
                });
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="">请选择已发布助手</option>
              {agentTargets.map((target) => (
                <option key={target.versionId} value={target.versionId}>{target.agentName}（版本 {target.version}）</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="node-handoff-deliverables" className="text-sm font-medium">必须交付</label>
            <textarea
              id="node-handoff-deliverables"
              value={(node.contract?.deliverables ?? []).join("\n")}
              rows={3}
              placeholder="每行一项"
              onChange={(event) => onNodeChange({
                ...node,
                contract: { ...node.contract, deliverables: lines(event.target.value), mustNotInclude: node.contract?.mustNotInclude ?? DEFAULT_HANDOFF_PROHIBITED, inputSchema: node.contract?.inputSchema ?? [], outputSchema: node.contract?.outputSchema ?? [] },
              })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="node-handoff-prohibited" className="text-sm font-medium">禁止传递</label>
            <textarea
              id="node-handoff-prohibited"
              value={(node.contract?.mustNotInclude ?? []).join("\n")}
              rows={3}
              placeholder="每行一项"
              onChange={(event) => onNodeChange({
                ...node,
                contract: { ...node.contract, deliverables: node.contract?.deliverables ?? [], mustNotInclude: lines(event.target.value), inputSchema: node.contract?.inputSchema ?? [], outputSchema: node.contract?.outputSchema ?? [] },
              })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-gray-500">交接时会冻结助手版本，并自动移除密钥、令牌等敏感字段。</p>
        </div>
      ) : null}
      {deletable ? (
        <button
          type="button"
          onClick={() => onNodeDelete(node.id)}
          className="w-fit rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:border-red-400"
        >
          删除节点
        </button>
      ) : null}
    </aside>
  );
}
