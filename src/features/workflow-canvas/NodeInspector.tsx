"use client";

import type { WorkflowNode } from "@/contracts/workflow";
import { NODE_TYPE_LABELS } from "./CustomNodes";

interface NodeInspectorProps {
  node: WorkflowNode;
  onNodeChange: (node: WorkflowNode) => void;
  onNodeDelete: (nodeId: string) => void;
}

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function NodeInspector({ node, onNodeChange, onNodeDelete }: NodeInspectorProps) {
  const isHuman = node.type === "human";
  const isCondition = node.type === "condition";
  const knowledge = node.knowledge;
  const wait = node.wait;
  const loop = node.loop;
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
      {node.type === "wait" && wait ? (
        <section className="flex flex-col gap-3 rounded-md border border-cyan-100 bg-cyan-50 p-3">
          <h3 className="text-sm font-semibold">等待设置</h3>
          <label className="flex flex-col gap-1 text-sm">
            等待方式
            <select
              value={wait.mode}
              onChange={(event) => onNodeChange({ ...node, wait: { ...wait, mode: event.target.value as typeof wait.mode } })}
              className="rounded-md border border-gray-300 bg-white px-3 py-2"
            >
              <option value="delay">等待一段时间</option>
              <option value="until">到指定时间继续</option>
              <option value="event">收到消息后继续</option>
            </select>
          </label>
          {wait.mode === "delay" ? (
            <label className="flex flex-col gap-1 text-sm">
              等待秒数
              <input
                type="number"
                min={0}
                step={1}
                value={Math.round(wait.durationMs / 1000)}
                onChange={(event) => onNodeChange({ ...node, wait: { ...wait, durationMs: Math.max(0, Math.round(Number(event.target.value) * 1000)) } })}
                className="rounded-md border border-gray-300 bg-white px-3 py-2"
              />
            </label>
          ) : null}
          {wait.mode === "until" ? (
            <label className="flex flex-col gap-1 text-sm">
              继续时间（本地时间）
              <input
                type="datetime-local"
                value={localDateTime(wait.until)}
                onChange={(event) => {
                  const date = event.target.value ? new Date(event.target.value) : null;
                  onNodeChange({ ...node, wait: { ...wait, until: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null } });
                }}
                className="rounded-md border border-gray-300 bg-white px-3 py-2"
              />
              {!wait.until ? <span className="text-xs text-amber-800">请填写继续时间。</span> : null}
            </label>
          ) : null}
          {wait.mode === "event" ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                等待的消息名称
                <input
                  value={wait.eventLabel ?? ""}
                  maxLength={80}
                  onChange={(event) => onNodeChange({ ...node, wait: { ...wait, eventLabel: event.target.value } })}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                消息标识
                <input
                  value={wait.eventKey}
                  maxLength={120}
                  onChange={(event) => onNodeChange({ ...node, wait: { ...wait, eventKey: event.target.value.replace(/[^a-zA-Z0-9._:-]/g, "") } })}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2"
                />
              </label>
              <p className="text-xs text-gray-600">外部系统发送消息时使用此标识。只能填写英文字母、数字和 . _ : -。</p>
              {!wait.eventKey ? <p className="text-xs text-amber-800">请填写消息标识。</p> : null}
              <label className="flex flex-col gap-1 text-sm">
                最长等待秒数（0 表示一直等待）
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={Math.round(wait.timeoutMs / 1000)}
                  onChange={(event) => onNodeChange({ ...node, wait: { ...wait, timeoutMs: Math.max(0, Math.round(Number(event.target.value) * 1000)) } })}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2"
                />
              </label>
              {wait.timeoutMs > 0 ? (
                <p className={wait.onTimeoutNext ? "text-xs text-gray-600" : "text-xs text-amber-800"}>
                  从右侧“超时后”连线到处理步骤；没有连线时，超时会停止运行。
                </p>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {node.type === "loop" && loop ? (
        <section className="flex flex-col gap-3 rounded-md border border-indigo-100 bg-indigo-50 p-3">
          <h3 className="text-sm font-semibold">逐项处理设置</h3>
          <label className="flex flex-col gap-1 text-sm">
            要处理的列表
            <input
              value={loop.collectionPath}
              maxLength={200}
              onChange={(event) => onNodeChange({ ...node, loop: { ...loop, collectionPath: event.target.value.trim() } })}
              placeholder="input.records"
              className="rounded-md border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <p className="text-xs text-gray-600">填写输入中的列表路径，例如 input.records；也可以引用前面步骤的结果。</p>
          {!loop.collectionPath ? <p className="text-xs text-amber-800">请填写列表路径。</p> : null}
          <label className="flex flex-col gap-1 text-sm">
            单项名称
            <input
              value={loop.itemKey}
              maxLength={80}
              onChange={(event) => onNodeChange({ ...node, loop: { ...loop, itemKey: event.target.value } })}
              placeholder="currentItem"
              className="rounded-md border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <p className="text-xs text-gray-600">运行结果会记录当前处理项及这个名称。</p>
          <label className="flex flex-col gap-1 text-sm">
            最多处理项数
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={loop.maxIterations}
              onChange={(event) => {
                const count = Number(event.target.value);
                if (Number.isInteger(count) && count >= 1 && count <= 100) {
                  onNodeChange({ ...node, loop: { ...loop, maxIterations: count } });
                }
              }}
              className="rounded-md border border-gray-300 bg-white px-3 py-2"
            />
          </label>
          <p className="text-xs text-gray-600">超出的项目不会处理，最多可设置 100 项。</p>
          {!loop.bodyNext || !loop.exitNext ? (
            <p className="text-xs text-amber-800">请分别从节点右侧的“逐项处理”和“完成”连接后续步骤。</p>
          ) : null}
        </section>
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
