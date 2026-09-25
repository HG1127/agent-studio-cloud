"use client";

import { useState } from "react";
import type { AgentTargetOption } from "@/contracts/agent";
import type { KnowledgeSourceView } from "@/contracts/knowledge";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import {
  MAX_CONDITION_BRANCHES,
  MAX_PARALLEL_BRANCHES,
  MAX_PARALLEL_STEPS,
  MAX_SUBFLOW_STEPS,
  type WorkflowNode,
} from "@/contracts/workflow";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";
import { NODE_TYPE_LABELS } from "./CustomNodes";

interface NodeInspectorProps {
  node: WorkflowNode;
  workflowNodes?: Record<string, WorkflowNode>;
  agentTargets?: AgentTargetOption[];
  toolOptions?: ToolRegistryOption[];
  knowledgeSources?: KnowledgeSourceView[];
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

function inlineStep(steps: Array<Record<string, unknown>>, title: string): Record<string, unknown> {
  let index = steps.length + 1;
  while (steps.some((step) => step.id === `step_${index}`)) index += 1;
  return { id: `step_${index}`, title, type: "ai", description: "完成这一步并返回结果" };
}

function changeInlineStep(
  steps: Array<Record<string, unknown>>,
  index: number,
  field: "title" | "description",
  value: string,
): Array<Record<string, unknown>> {
  return steps.map((step, stepIndex) => stepIndex === index ? { ...step, [field]: value } : step);
}

const INLINE_STEP_TYPES = ["ai", "system", "tool", "knowledge", "memory", "agent_call", "handoff"] as const;
type InlineStepType = (typeof INLINE_STEP_TYPES)[number];
const CONDITION_OPERATORS = [
  ["eq", "等于"], ["neq", "不等于"], ["contains", "包含"],
  ["gt", "大于"], ["gte", "大于等于"], ["lt", "小于"], ["lte", "小于等于"],
  ["truthy", "有值且为真"], ["exists", "存在"],
] as const;

function changeInlineStepType(steps: Array<Record<string, unknown>>, index: number, type: InlineStepType) {
  return steps.map((step, stepIndex) => {
    if (stepIndex !== index) return step;
    if (type === "tool") return { ...step, type, tool: step.tool ?? { connector: "demo", action: "demo", scope: "demo", risk: "low", maxRetries: 1, registryToolId: "demo", protocol: "demo", inputSchema: { type: "object" }, outputSchema: { type: "object" } } };
    if (type === "knowledge") return { ...step, type, knowledge: step.knowledge ?? { space: "业务资料库", query: "" } };
    if (type === "memory") return { ...step, type, memory: step.memory ?? { mode: "read", limit: 5 } };
    if (type === "agent_call") return { ...step, type, agentCall: step.agentCall ?? { targetAgentId: "", versionId: "" } };
    if (type === "handoff") return { ...step, type, toAgent: step.toAgent ?? { id: "", versionId: "" } };
    return { ...step, type };
  });
}

function boundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function inlineToolSpec(toolId: string, currentAction: string, options: ToolRegistryOption[]) {
  const selected = options.find((item) => item.id === toolId);
  if (!selected) return {
    connector: "demo", action: currentAction || "demo", scope: "demo", risk: "low" as const,
    maxRetries: 1, registryToolId: "demo", protocol: "demo", unresolved: false,
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
  };
  return {
    connector: selected.name, action: selected.action, scope: selected.scope, risk: selected.risk,
    maxRetries: 3, registryToolId: selected.id, protocol: "http-json", unresolved: false,
    operationKind: selected.risk === "low" ? "read" as const : "action" as const,
    inputSchema: selected.inputSchema, outputSchema: selected.outputSchema,
  };
}

function agentCallSelection(target: AgentTargetOption | undefined) {
  return target ? {
    targetAgentId: target.agentId,
    targetAgentName: target.agentName,
    versionId: target.versionId,
    workflowId: target.versionId,
    memoryAccess: { mode: "none" as const },
    inputContract: target.inputContract,
    outputContract: target.outputContract,
  } : { targetAgentId: "", versionId: "" };
}

function handoffSelection(target: AgentTargetOption | undefined) {
  const outputFields = target ? contractFields(target.outputContract, "path") : [];
  const inputFields = target ? contractFields(target.inputContract, "name") : [];
  return {
    toAgent: target ? { id: target.agentId, name: target.agentName, versionId: target.versionId } : { id: "", versionId: "" },
    contract: target ? {
      deliverables: outputFields.length > 0
        ? outputFields.map((field) => field.label || field.name)
        : ["完成交接任务并返回可核对的结果"],
      mustNotInclude: DEFAULT_HANDOFF_PROHIBITED,
      inputSchema: inputFields.length > 0 ? inputFields : [{ name: "brief", label: "交接说明", type: "string" as const, required: true }],
      outputSchema: outputFields.length > 0 ? outputFields : [{ name: "result", label: "交接结果", type: "any" as const, required: true }],
      memoryPolicy: { mode: "none" as const, shared: [], private: ["密钥", "个人隐私", "内部草稿"] },
    } : undefined,
  };
}

function InlineStepEditor({ label, steps, index, toolOptions, agentTargets, knowledgeSources, removable, onChange, onDelete }: {
  label: string;
  steps: Array<Record<string, unknown>>;
  index: number;
  toolOptions: ToolRegistryOption[];
  agentTargets: AgentTargetOption[];
  knowledgeSources: KnowledgeSourceView[];
  removable: boolean;
  onChange: (steps: Array<Record<string, unknown>>) => void;
  onDelete: () => void;
}) {
  const step = steps[index];
  const type = INLINE_STEP_TYPES.includes(step.type as InlineStepType) ? step.type as InlineStepType : "ai";
  const tool = step.tool && typeof step.tool === "object" ? step.tool as Record<string, unknown> : null;
  const retry = step.retry && typeof step.retry === "object" ? step.retry as Record<string, unknown> : null;
  const knowledge = step.knowledge && typeof step.knowledge === "object" ? step.knowledge as Record<string, unknown> : null;
  const maxAttempts = Number(retry?.maxAttempts ?? tool?.maxRetries ?? 1);
  const backoffMs = Number(retry?.backoffMs ?? 5_000);
  return <div className="grid gap-1 rounded-md bg-gray-50 p-2 md:grid-cols-[110px_1fr_2fr_auto]">
    <select aria-label={`${label} 类型`} value={type}
      onChange={(event) => onChange(changeInlineStepType(steps, index, event.target.value as InlineStepType))}
      className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs">
      <option value="ai">智能处理</option><option value="system">自动记录</option><option value="tool">业务工具</option>
      <option value="knowledge">读取资料</option><option value="memory">参考经验</option>
      <option value="agent_call">呼叫其他助手</option><option value="handoff">交给其他助手</option>
    </select>
    <input aria-label={`${label} 名称`} value={String(step.title ?? "")}
      onChange={(event) => onChange(changeInlineStep(steps, index, "title", event.target.value))}
      className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
    <input aria-label={`${label} 说明`} value={String(step.description ?? "")}
      onChange={(event) => onChange(changeInlineStep(steps, index, "description", event.target.value))}
      className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
    {removable ? <button type="button" aria-label={`删除${label}`} onClick={onDelete} className="text-xs text-red-600">删除</button> : <span />}
    {type === "tool" ? <div className="grid gap-2 md:col-span-4 md:grid-cols-3">
      <select aria-label={`${label} 业务工具`} value={String(tool?.registryToolId ?? "demo")}
        onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
          ...item,
          tool: inlineToolSpec(event.target.value, String(tool?.action ?? "demo"), toolOptions),
        } : item))}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-xs">
        <option value="demo">演示工具（不连接业务系统）</option>
        {toolOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      <label className="flex items-center gap-2 text-xs text-gray-600">最多尝试
        <input aria-label={`${label} 最多尝试次数`} type="number" min={1} max={8} value={maxAttempts}
          onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
            ...item,
            retry: { maxAttempts: Math.round(boundedNumber(event.target.value, maxAttempts, 1, 8)), backoffMs },
          } : item))}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />次
      </label>
      <label className="flex items-center gap-2 text-xs text-gray-600">失败后等待
        <input aria-label={`${label} 重试间隔秒数`} type="number" min={0.05} max={60} step={0.05} value={backoffMs / 1_000}
          onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
            ...item,
            retry: { maxAttempts, backoffMs: Math.round(boundedNumber(event.target.value, backoffMs / 1_000, 0.05, 60) * 1_000) },
          } : item))}
          className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />秒
      </label>
    </div> : null}
    {type === "knowledge" ? <div className="space-y-2 md:col-span-4">
      <input aria-label={`${label} 检索内容`} value={String(knowledge?.query ?? "")} placeholder="留空则使用本次运行输入"
        onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
          ...item,
          knowledge: { ...(knowledge ?? { space: "业务资料库" }), query: event.target.value },
        } : item))}
        className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
      <KnowledgeSourcePicker label={`${label} 资料范围`} sourceIds={Array.isArray(knowledge?.sourceIds) ? knowledge.sourceIds.filter((id): id is string => typeof id === "string") : []}
        sources={knowledgeSources}
        onChange={(sourceIds) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
          ...item,
          knowledge: { ...(knowledge ?? { space: "业务资料库" }), sourceIds },
        } : item))} compact />
    </div> : null}
    {type === "agent_call" ? <select aria-label={`${label} 协作助手`}
      value={String((step.agentCall as Record<string, unknown> | undefined)?.versionId ?? "")}
      onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        agentCall: agentCallSelection(agentTargets.find((target) => target.versionId === event.target.value)),
      } : item))}
      className="rounded-md border border-gray-300 px-2 py-1.5 text-xs md:col-span-4">
      <option value="">请选择已发布助手</option>
      {agentTargets.map((target) => <option key={target.versionId} value={target.versionId}>{target.agentName}（版本 {target.version}）</option>)}
    </select> : null}
    {type === "agent_call" ? <select aria-label={`${label} 经验共享范围`}
      value={String(((step.agentCall as Record<string, unknown> | undefined)?.memoryAccess as Record<string, unknown> | undefined)?.mode ?? "none")}
      onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        agentCall: {
          ...(item.agentCall as Record<string, unknown> | undefined),
          memoryAccess: { mode: event.target.value as "none" | "self" | "team" },
        },
      } : item))}
      className="rounded-md border border-gray-300 px-2 py-1.5 text-xs md:col-span-4">
      <option value="none">不传递长期经验</option>
      <option value="self">仅使用目标助手自身经验</option>
      <option value="team">共享当前助手已读取的经验</option>
    </select> : null}
    {type === "handoff" ? <select aria-label={`${label} 接收助手`}
      value={String((step.toAgent as Record<string, unknown> | undefined)?.versionId ?? "")}
      onChange={(event) => onChange(steps.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        ...handoffSelection(agentTargets.find((target) => target.versionId === event.target.value)),
      } : item))}
      className="rounded-md border border-gray-300 px-2 py-1.5 text-xs md:col-span-4">
      <option value="">请选择已发布助手</option>
      {agentTargets.map((target) => <option key={target.versionId} value={target.versionId}>{target.agentName}（版本 {target.version}）</option>)}
    </select> : null}
  </div>;
}

function KnowledgeSourcePicker({ label, sourceIds, sources, onChange, compact = false }: {
  label: string;
  sourceIds: string[];
  sources: KnowledgeSourceView[];
  onChange: (sourceIds: string[]) => void;
  compact?: boolean;
}) {
  const selected = new Set(sourceIds);
  const unavailableCount = sourceIds.filter((sourceId) => !sources.some((source) => source.id === sourceId)).length;
  return <fieldset className={`space-y-1 rounded-md border border-gray-200 ${compact ? "p-2" : "p-3"}`}>
    <legend className={compact ? "px-1 text-xs font-medium" : "px-1 text-sm font-medium"}>{label}</legend>
    <label className="flex items-center gap-2 text-xs text-gray-700">
      <input type="checkbox" checked={sourceIds.length === 0} onChange={() => onChange([])} />
      全部已入库资料
    </label>
    {sources.map((source) => <label key={source.id} className="flex items-center gap-2 text-xs text-gray-700">
      <input type="checkbox" checked={selected.has(source.id)} onChange={(event) => {
        const next = event.target.checked
          ? [...new Set([...sourceIds, source.id])]
          : sourceIds.filter((id) => id !== source.id);
        onChange(next);
      }} />
      {source.name}
    </label>)}
    {sources.length === 0 ? <p className="text-xs text-amber-700">还没有完成解析的资料，请先到知识库上传。</p> : null}
    {unavailableCount > 0 ? <p className="text-xs text-amber-700">有 {unavailableCount} 份已选资料当前不可用，请改选可用资料或切换为全部资料。</p> : null}
    <p className="text-xs text-gray-500">不单独选择时使用发布当时的全部可用资料。</p>
  </fieldset>;
}

function WaitPayloadSchemaEditor({ node, onNodeChange }: {
  node: WorkflowNode;
  onNodeChange: (node: WorkflowNode) => void;
}) {
  const serialized = JSON.stringify(node.wait?.payloadSchema ?? { type: "object" }, null, 2);
  const [value, setValue] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      const schema = parsed as Record<string, unknown>;
      const schemaError = validateJsonSchemaDefinition(schema);
      if (schemaError) {
        setError(schemaError);
        return;
      }
      const rootTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (schema.type !== undefined && !rootTypes.includes("object")) {
        setError("消息字段契约的根类型必须是 object");
        return;
      }
      setError(null);
      onNodeChange({ ...node, wait: { ...node.wait!, payloadSchema: schema } });
    } catch {
      setError("字段契约不是有效的 JSON 对象");
    }
  }

  return <div className="flex flex-col gap-1">
    <label htmlFor="wait-payload-schema" className="text-sm font-medium">消息字段契约</label>
    <textarea id="wait-payload-schema" rows={8} spellCheck={false} value={value}
      onChange={(event) => setValue(event.target.value)}
      className="rounded-md border border-gray-300 px-3 py-2 font-mono text-xs font-normal" />
    <p className="text-xs text-gray-500">用 JSON 定义 properties 和 required；支持文字、数字、布尔、对象、列表与枚举。</p>
    <button type="button" onClick={apply} className="w-fit text-xs text-blue-700">应用字段契约</button>
    {error ? <p role="alert" className="text-xs text-red-600">{error}</p> : null}
  </div>;
}

// 通用标题/说明与各节点专属配置集中在同一检查面板；condition 的说明以「判断说明」呈现。
export function NodeInspector({ node, workflowNodes = { [node.id]: node }, agentTargets = [], toolOptions = [], knowledgeSources = [], onNodeChange, onNodeDelete }: NodeInspectorProps) {
  const isHuman = node.type === "human";
  const isCondition = node.type === "condition";
  const knowledge = node.knowledge;
  const deletable = node.type !== "trigger" && node.type !== "end";
  const memorySources = Object.values(workflowNodes).filter((candidate) =>
    candidate.id !== node.id
    && candidate.type !== "trigger"
    && candidate.type !== "end"
    && candidate.ui?.visibility !== "control",
  );
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
      {node.type === "tool" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="node-tool-target" className="text-sm font-medium">业务工具</label>
          <select
            id="node-tool-target"
            value={node.tool?.registryToolId ?? ""}
            onChange={(event) => {
              const selected = toolOptions.find((item) => item.id === event.target.value);
              onNodeChange({
                ...node,
                tool: selected ? {
                  connector: selected.name,
                  action: selected.action,
                  scope: selected.scope,
                  risk: selected.risk,
                  maxRetries: node.tool?.maxRetries ?? 3,
                  registryToolId: selected.id,
                  protocol: "http-json",
                  operationKind: selected.risk === "low" ? "read" : "action",
                  unresolved: false,
                  inputSchema: selected.inputSchema,
                  outputSchema: selected.outputSchema,
                } : {
                  connector: "demo", action: node.tool?.action || "demo", scope: "demo", risk: "low",
                  maxRetries: 1, registryToolId: "demo", protocol: "demo", unresolved: false,
                  inputSchema: { type: "object" }, outputSchema: { type: "object" },
                },
              });
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="demo">演示工具（不连接业务系统）</option>
            {toolOptions.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
          </select>
          {toolOptions.length === 0 ? <p className="text-xs text-gray-500">服务端还没有配置可用的业务工具</p> : null}
          {toolOptions.find((tool) => tool.id === node.tool?.registryToolId)?.description ? (
            <p className="text-xs text-gray-500">{toolOptions.find((tool) => tool.id === node.tool?.registryToolId)?.description}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm font-medium">最多尝试次数
              <input aria-label="最多尝试次数" type="number" min={1} max={8}
                value={node.retry?.maxAttempts ?? node.tool?.maxRetries ?? 1}
                onChange={(event) => onNodeChange({
                  ...node,
                  retry: {
                    maxAttempts: Math.round(boundedNumber(event.target.value, node.retry?.maxAttempts ?? node.tool?.maxRetries ?? 1, 1, 8)),
                    backoffMs: node.retry?.backoffMs ?? 5_000,
                  },
                })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">失败后等待秒数
              <input aria-label="失败后等待秒数" type="number" min={0.05} max={60} step={0.05}
                value={(node.retry?.backoffMs ?? 5_000) / 1_000}
                onChange={(event) => onNodeChange({
                  ...node,
                  retry: {
                    maxAttempts: node.retry?.maxAttempts ?? node.tool?.maxRetries ?? 1,
                    backoffMs: Math.round(boundedNumber(event.target.value, (node.retry?.backoffMs ?? 5_000) / 1_000, 0.05, 60) * 1_000),
                  },
                })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
          </div>
          <p className="text-xs text-gray-500">仅在连接超时、限流或业务系统临时故障时重试；字段或权限错误会立即停止。</p>
        </div>
      ) : null}
      {node.type === "knowledge" && knowledge ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="node-query" className="text-sm font-medium">检索内容</label>
          <input
            id="node-query"
            value={knowledge.query ?? ""}
            maxLength={200}
            onChange={(event) => onNodeChange({ ...node, knowledge: { ...knowledge, query: event.target.value } })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          />
          <KnowledgeSourcePicker label="资料范围" sourceIds={knowledge.sourceIds ?? []} sources={knowledgeSources}
            onChange={(sourceIds) => onNodeChange({ ...node, knowledge: { ...knowledge, sourceIds } })} />
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
              {CONDITION_OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">满足的情况</span>
            {node.condition.branches.map((branch, index) => {
              const rules = branch.rules ?? [];
              const updateBranch = (next: typeof branch) => onNodeChange({
                ...node,
                condition: {
                  ...node.condition!,
                  branches: node.condition!.branches.map((item, itemIndex) => itemIndex === index ? next : item),
                },
              });
              return <div key={index} className="space-y-2 rounded-md border border-gray-200 p-2">
                <div className="grid grid-cols-[1fr_auto] gap-1">
                  <input aria-label={`情况 ${index + 1} 名称`} value={branch.label} placeholder="情况名称"
                    onChange={(event) => updateBranch({ ...branch, label: event.target.value })}
                    className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                  <button type="button" aria-label={`删除情况 ${index + 1}`}
                    onClick={() => onNodeChange({ ...node, condition: { ...node.condition!, branches: node.condition!.branches.filter((_, itemIndex) => itemIndex !== index) } })}
                    className="px-1 text-xs text-red-600">删除</button>
                </div>
                {rules.length === 0 ? <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input aria-label={`情况 ${index + 1} 比较值`} value={branch.value === null ? "null" : String(branch.value ?? "")} placeholder="比较值"
                    onChange={(event) => updateBranch({ ...branch, value: parseConditionValue(event.target.value) })}
                    className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                  <button type="button" onClick={() => updateBranch({
                    ...branch,
                    mode: "all",
                    rules: [{ source: node.condition!.source ?? "", operator: node.condition!.operator, value: branch.value }],
                  })} className="text-xs text-blue-700">添加并列条件</button>
                </div> : <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-gray-700">条件组合
                    <select aria-label={`情况 ${index + 1} 条件组合`} value={branch.mode ?? "all"}
                      onChange={(event) => updateBranch({ ...branch, mode: event.target.value as "all" | "any" })}
                      className="rounded-md border border-gray-300 px-2 py-1.5 text-xs">
                      <option value="all">全部满足</option><option value="any">任一满足</option>
                    </select>
                  </label>
                  {rules.map((rule, ruleIndex) => <div key={ruleIndex} className="grid gap-1 md:grid-cols-[1.5fr_1fr_1fr_auto]">
                    <input aria-label={`情况 ${index + 1} 条件 ${ruleIndex + 1} 数据`} value={rule.source} placeholder="input.status"
                      onChange={(event) => updateBranch({ ...branch, rules: rules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, source: event.target.value } : item) })}
                      className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                    <select aria-label={`情况 ${index + 1} 条件 ${ruleIndex + 1} 判断方式`} value={rule.operator}
                      onChange={(event) => updateBranch({ ...branch, rules: rules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, operator: event.target.value } : item) })}
                      className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs">
                      {CONDITION_OPERATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                    <input aria-label={`情况 ${index + 1} 条件 ${ruleIndex + 1} 比较值`} value={rule.value === null ? "null" : String(rule.value ?? "")} placeholder="比较值"
                      onChange={(event) => updateBranch({ ...branch, rules: rules.map((item, itemIndex) => itemIndex === ruleIndex ? { ...item, value: parseConditionValue(event.target.value) } : item) })}
                      className="min-w-0 rounded-md border border-gray-300 px-2 py-1.5 text-xs" />
                    <button type="button" aria-label={`删除情况 ${index + 1} 条件 ${ruleIndex + 1}`}
                      disabled={rules.length === 1}
                      onClick={() => updateBranch({ ...branch, rules: rules.filter((_, itemIndex) => itemIndex !== ruleIndex) })}
                      className="text-xs text-red-600 disabled:text-gray-300">删除</button>
                  </div>)}
                  <div className="flex gap-3">
                    <button type="button" disabled={rules.length >= MAX_CONDITION_BRANCHES}
                      onClick={() => updateBranch({ ...branch, rules: [...rules, { source: "input.", operator: "eq", value: "" }] })}
                      className="text-xs text-blue-700 disabled:text-gray-400">添加条件</button>
                    <button type="button" onClick={() => updateBranch({ ...branch, value: rules[0]?.value, rules: undefined, mode: undefined })}
                      className="text-xs text-gray-600">改回单一条件</button>
                  </div>
                </div>}
              </div>;
            })}
            <button type="button" disabled={node.condition.branches.length >= MAX_CONDITION_BRANCHES} onClick={() => onNodeChange({ ...node, condition: { ...node.condition!, branches: [...node.condition!.branches, { label: `情况 ${node.condition!.branches.length + 1}`, value: "", next: null }] } })}
              className="w-fit text-xs text-blue-700 disabled:text-gray-400">添加情况</button>
            <p className="text-xs text-gray-500">添加后，从节点右侧对应圆点连接到下一步；最下方圆点代表其他情况。</p>
          </div>
        </div>
      ) : null}
      {node.type === "parallel" && node.parallel ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">完成方式
            <select aria-label="并行完成方式" value={node.parallel.strategy}
              onChange={(event) => onNodeChange({ ...node, parallel: { ...node.parallel!, strategy: event.target.value as "all" | "any" | "all_settled" } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal">
              <option value="all">全部完成</option><option value="any">任一完成</option><option value="all_settled">全部结束，保留失败结果</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">失败处理
            <select aria-label="并行失败处理" value={node.parallel.failurePolicy}
              onChange={(event) => onNodeChange({ ...node, parallel: { ...node.parallel!, failurePolicy: event.target.value as "fail_fast" | "continue" } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal">
              <option value="fail_fast">停止整个流程</option><option value="continue">记录问题后继续</option>
            </select>
          </label>
          {node.parallel.branches.map((branch, branchIndex) => (
            <div key={branch.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex items-center gap-2">
                <input aria-label={`并行工作 ${branchIndex + 1} 名称`} value={branch.label}
                  onChange={(event) => onNodeChange({ ...node, parallel: { ...node.parallel!, branches: node.parallel!.branches.map((item, index) => index === branchIndex ? { ...item, label: event.target.value } : item) } })}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                {node.parallel!.branches.length > 2 ? <button type="button" aria-label={`删除并行工作 ${branchIndex + 1}`}
                  onClick={() => onNodeChange({ ...node, parallel: { ...node.parallel!, branches: node.parallel!.branches.filter((_, index) => index !== branchIndex) } })}
                  className="text-xs text-red-600">删除</button> : null}
              </div>
              <div className="mt-2 space-y-2">
                {branch.steps.map((step, stepIndex) => (
                  <InlineStepEditor key={String(step.id ?? stepIndex)}
                    label={`并行工作 ${branchIndex + 1} 步骤 ${stepIndex + 1}`}
                    steps={branch.steps} index={stepIndex} toolOptions={toolOptions} agentTargets={agentTargets} knowledgeSources={knowledgeSources} removable={branch.steps.length > 1}
                    onChange={(steps) => onNodeChange({ ...node, parallel: { ...node.parallel!, branches: node.parallel!.branches.map((item, index) => index === branchIndex ? { ...item, steps } : item) } })}
                    onDelete={() => onNodeChange({ ...node, parallel: { ...node.parallel!, branches: node.parallel!.branches.map((item, index) => index === branchIndex ? { ...item, steps: item.steps.filter((_, index2) => index2 !== stepIndex) } : item) } })} />
                ))}
              </div>
              <button type="button" disabled={branch.steps.length >= MAX_PARALLEL_STEPS} onClick={() => onNodeChange({ ...node, parallel: { ...node.parallel!, branches: node.parallel!.branches.map((item, index) => index === branchIndex ? { ...item, steps: [...item.steps, inlineStep(item.steps, `处理${item.label}的新步骤`)] } : item) } })}
                className="mt-2 text-xs text-blue-700 disabled:text-gray-400">添加步骤</button>
            </div>
          ))}
          <button type="button" disabled={node.parallel.branches.length >= MAX_PARALLEL_BRANCHES} onClick={() => {
            const index = node.parallel!.branches.length + 1;
            const branch = { id: `branch_${index}`, label: `工作${index}`, inputs: [], outputs: [], steps: [inlineStep([], `处理工作${index}`)] };
            onNodeChange({ ...node, parallel: { ...node.parallel!, branches: [...node.parallel!.branches, branch] } });
          }} className="w-fit text-xs text-blue-700 disabled:text-gray-400">添加并行工作</button>
        </div>
      ) : null}
      {node.type === "subflow" && node.subflow ? (
        <div className="flex flex-col gap-3 border-t border-gray-100 pt-3">
          <label className="flex flex-col gap-1 text-sm font-medium">步骤组名称
            <input aria-label="步骤组名称" value={node.subflow.name}
              onChange={(event) => onNodeChange({ ...node, subflow: { ...node.subflow!, name: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">失败处理
            <select aria-label="步骤组失败处理" value={node.subflow.failurePolicy ?? "checkpoint"}
              onChange={(event) => onNodeChange({ ...node, subflow: { ...node.subflow!, failurePolicy: event.target.value as "checkpoint" | "continue" } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal">
              <option value="checkpoint">停止整个流程</option><option value="continue">记录问题后继续</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">需要的数据
            <textarea aria-label="步骤组输入" rows={2} value={node.subflow.inputs.join("\n")} placeholder="每行一项，可不填"
              onChange={(event) => onNodeChange({ ...node, subflow: { ...node.subflow!, inputs: lines(event.target.value) } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">产出的数据
            <textarea aria-label="步骤组输出" rows={2} value={node.subflow.outputs.join("\n")} placeholder="每行一项，可不填"
              onChange={(event) => onNodeChange({ ...node, subflow: { ...node.subflow!, outputs: lines(event.target.value) } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label>
          <div className="space-y-2">
            {node.subflow.steps.map((step, stepIndex) => (
              <InlineStepEditor key={String(step.id ?? stepIndex)} label={`步骤组步骤 ${stepIndex + 1}`}
                steps={node.subflow!.steps} index={stepIndex} toolOptions={toolOptions} agentTargets={agentTargets} knowledgeSources={knowledgeSources} removable={node.subflow!.steps.length > 1}
                onChange={(steps) => onNodeChange({ ...node, subflow: { ...node.subflow!, steps } })}
                onDelete={() => onNodeChange({ ...node, subflow: { ...node.subflow!, steps: node.subflow!.steps.filter((_, index) => index !== stepIndex) } })} />
            ))}
          </div>
          <button type="button" disabled={node.subflow.steps.length >= MAX_SUBFLOW_STEPS} onClick={() => onNodeChange({ ...node, subflow: { ...node.subflow!, steps: [...node.subflow!.steps, inlineStep(node.subflow!.steps, "处理下一步")] } })}
            className="w-fit text-xs text-blue-700 disabled:text-gray-400">添加步骤</button>
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
            <input aria-label="继续时间" type="datetime-local" value={toDateTimeLocalValue(node.wait.until)}
              onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, until: fromDateTimeLocalValue(event.target.value) } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
          </label> : null}
          {node.wait.mode === "event" ? <>
            <label className="flex flex-col gap-1 text-sm font-medium">消息标识
              <input aria-label="消息标识" value={node.wait.eventKey} maxLength={120}
                onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, eventKey: event.target.value.replace(/[^a-zA-Z0-9._:-]/g, "").slice(0, 120) } })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
              <span className="text-xs font-normal text-gray-500">仅使用字母、数字、点、下划线、冒号或短横线。</span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">超时分钟数
              <input aria-label="超时分钟数" type="number" min={0} value={Math.round(node.wait.timeoutMs / 60_000)}
                onChange={(event) => onNodeChange({ ...node, wait: { ...node.wait!, timeoutMs: Math.max(0, Number(event.target.value) || 0) * 60_000 } })}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <WaitPayloadSchemaEditor node={node} onNodeChange={onNodeChange} />
          </> : null}
        </div>
      ) : null}
      {node.type === "memory" && node.memory ? (
        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <label htmlFor="memory-mode" className="text-sm font-medium">经验操作</label>
          <select id="memory-mode" value={node.memory.mode}
            onChange={(event) => onNodeChange({ ...node, memory: event.target.value === "read" ? { mode: "read", query: "", limit: 5 } : { mode: "write", contentFrom: "run_summary" } })}
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
            <select aria-label="保存内容来源" value={node.memory.contentFrom || "run_summary"}
              onChange={(event) => onNodeChange({ ...node, memory: { ...node.memory!, contentFrom: event.target.value } })}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-normal">
              <option value="run_summary">本次输入和全部结果</option>
              {node.memory.contentFrom && node.memory.contentFrom !== "run_summary" && !memorySources.some((source) => source.id === node.memory!.contentFrom)
                ? <option value={node.memory.contentFrom}>来源已不可用</option> : null}
              {memorySources.map((source) => <option key={source.id} value={source.id}>{source.title}</option>)}
            </select>
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
        <div className="flex flex-col gap-2">
          <label htmlFor="node-agent-target" className="text-sm font-medium">协作助手</label>
          <select
            id="node-agent-target"
            value={node.agentCall?.versionId ?? ""}
            onChange={(event) => {
              const target = agentTargets.find((item) => item.versionId === event.target.value);
              onNodeChange({
                ...node,
                agentCall: agentCallSelection(target),
              });
            }}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          >
            <option value="">请选择已发布助手</option>
            {agentTargets.map((target) => (
              <option key={target.versionId} value={target.versionId}>{target.agentName}（版本 {target.version}）</option>
            ))}
          </select>
          <label htmlFor="agent-call-memory" className="text-sm font-medium">经验共享范围</label>
          <select id="agent-call-memory" aria-label="经验共享范围"
            value={node.agentCall?.memoryAccess?.mode ?? "none"}
            onChange={(event) => onNodeChange({
              ...node,
              agentCall: { ...node.agentCall!, memoryAccess: { mode: event.target.value as "none" | "self" | "team" } },
            })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none">
            <option value="none">不传递长期经验</option>
            <option value="self">仅使用目标助手自身经验</option>
            <option value="team">共享当前助手已读取的经验</option>
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
                onNodeChange({
                  ...node,
                  ...handoffSelection(target),
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
export function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseConditionValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed !== null ? value : parsed;
  } catch {
    return value;
  }
}
