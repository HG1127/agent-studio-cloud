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
      {node.type === "condition" && node.condition ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="condition-source" className="text-sm font-medium">判断数据</label>
            <input id="condition-source" value={node.condition.source ?? ""} placeholder="input.status"
              onChange={(event) => onNodeChange({ ...node, condition: { ...node.condition!, source: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="condition-operator" className="text-sm font-medium">判断方式</label>
            <select id="condition-operator" value={node.condition.operator}
              onChange={(event) => onNodeChange({ ...node, condition: { ...node.condition!, operator: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="eq">等于</option><option value="neq">不等于</option><option value="contains">包含</option>
              <option value="gt">大于</option><option value="gte">大于等于</option><option value="lt">小于</option><option value="lte">小于等于</option>
              <option value="truthy">有值且为真</option><option value="exists">存在</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">满足的情况</span>
            {node.condition.branches.map((branch, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                <input aria-label={`情况 ${index + 1} 名称`} value={branch.label} placeholder="情况名称"
                  onChange={(event) => onNodeChange({ ...node, condition: { ...node.condition!, branches: node.condition!.branches.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) } })}
                  className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                <input aria-label={`情况 ${index + 1} 比较值`} value={String(branch.value ?? "")} placeholder="比较值"
                  onChange={(event) => onNodeChange({ ...node, condition: { ...node.condition!, branches: node.condition!.branches.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) } })}
                  className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                <button type="button" aria-label={`删除情况 ${index + 1}`}
                  onClick={() => onNodeChange({ ...node, condition: { ...node.condition!, branches: node.condition!.branches.filter((_, itemIndex) => itemIndex !== index) } })}
                  className="px-1 text-xs text-red-600">删除</button>
              </div>
            ))}
            <button type="button" onClick={() => onNodeChange({ ...node, condition: { ...node.condition!, branches: [...node.condition!.branches, { label: `情况 ${node.condition!.branches.length + 1}`, value: "", next: null }] } })}
              className="w-fit text-xs text-blue-700">添加情况</button>
            <p className="text-xs text-gray-500">添加后，从节点右侧对应圆点连接到下一步；最下方圆点代表其他情况。</p>
          </div>
        </div>
      ) : null}
      {node.type === "loop" && node.loop ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">列表数据
            <input aria-label="列表数据" value={node.loop.collectionPath} placeholder="input.items"
              onChange={(event) => onNodeChange({ ...node, loop: { ...node.loop!, collectionPath: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">每项名称
            <input aria-label="每项名称" value={node.loop.itemKey}
              onChange={(event) => onNodeChange({ ...node, loop: { ...node.loop!, itemKey: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">最多处理条数
            <input aria-label="最多处理条数" type="number" min={1} max={100} value={node.loop.maxIterations}
              onChange={(event) => onNodeChange({ ...node, loop: { ...node.loop!, maxIterations: Math.max(1, Math.min(100, Number(event.target.value) || 1)) } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <p className="text-xs text-gray-500">从“逐项处理”和“完成”两个圆点分别连接循环步骤和后续步骤。</p>
        </div>
      ) : null}
      {node.type === "wait" && node.wait ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <label htmlFor="wait-mode" className="text-sm font-medium">等待方式</label>
          <select id="wait-mode" value={node.wait.mode}
            onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, mode: event.target.value as "delay" | "until" | "event" } })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="delay">等待一段时间</option><option value="until">等待到指定时间</option><option value="event">等待外部消息</option>
          </select>
          {node.wait.mode === "delay" ? <label className="flex flex-col gap-1 text-sm font-medium">等待秒数
            <input aria-label="等待秒数" type="number" min={1} value={Math.max(1, Math.round(node.wait.durationMs / 1000))}
              onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, durationMs: Math.max(1, Number(event.target.value) || 1) * 1000 } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label> : null}
          {node.wait.mode === "until" ? <label className="flex flex-col gap-1 text-sm font-medium">继续时间
            <input aria-label="继续时间" type="datetime-local" value={(node.wait.until ?? "").slice(0, 16)}
              onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, until: event.target.value || null } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label> : null}
          {node.wait.mode === "event" ? <>
            <label className="flex flex-col gap-1 text-sm font-medium">消息标识
              <input aria-label="消息标识" value={node.wait.eventKey} onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, eventKey: event.target.value } })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">超时分钟数
              <input aria-label="超时分钟数" type="number" min={0} value={Math.round(node.wait.timeoutMs / 60_000)}
                onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, timeoutMs: Math.max(0, Number(event.target.value) || 0) * 60_000 } })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
          </> : null}
        </div>
      ) : null}
      {node.type === "memory" && node.memory ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <label htmlFor="memory-mode" className="text-sm font-medium">经验操作</label>
          <select id="memory-mode" value={node.memory.mode}
            onChange={(event) => onNodeChange({ ...node, memory: event.target.value === "read" ? { mode: "read", query: "", limit: 5 } : { mode: "write", contentFrom: "" } })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="read">读取相关经验</option><option value="write">保存本次经验</option>
          </select>
          {node.memory.mode === "read" ? <>
            <label className="flex flex-col gap-1 text-sm font-medium">查找内容
              <input aria-label="查找内容" value={node.memory.query ?? ""} placeholder="留空则使用本次输入"
                onChange={(event) => onNodeChange({ ...node, memory: { ...node.memory!, query: event.target.value } })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">最多参考条数
              <input aria-label="最多参考条数" type="number" min={1} max={20} value={node.memory.limit ?? 5}
                onChange={(event) => onNodeChange({ ...node, memory: { ...node.memory!, limit: Math.max(1, Math.min(20, Number(event.target.value) || 1)) } })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
          </> : <label className="flex flex-col gap-1 text-sm font-medium">保存内容来源
            <input aria-label="保存内容来源" value={node.memory.contentFrom ?? ""} placeholder="留空则保存本次结果"
              onChange={(event) => onNodeChange({ ...node, memory: { ...node.memory!, contentFrom: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>}
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
