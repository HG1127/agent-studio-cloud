"use client";

import { useId, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import type { PublicToolListResult, PublicToolView } from "@/contracts/public-agent-tool";

const TOOL_STATE = { draft: "尚未开放", enabled: "已开放", disabled: "已停用" };
const FILTERS = [
  { value: "all", label: "全部", accessibleLabel: "全部工具" },
  { value: "draft", label: "未开放", accessibleLabel: "未开放工具" },
  { value: "enabled", label: "已开放", accessibleLabel: "已开放工具" },
  { value: "disabled", label: "已停用", accessibleLabel: "已停用工具" },
] as const;

function displayName(value: string) {
  return !value.trim() || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim()) ? "未命名工具" : value.trim();
}

export function PublicToolInventory({ list, targets, currentUnknown, selectedId, locked, onSelect }: {
  list: Extract<PublicToolListResult, { ok: true }> | null;
  targets: AgentTargetOption[] | null;
  currentUnknown: boolean;
  selectedId: string | null;
  locked: boolean;
  onSelect: (tool: PublicToolView) => void;
}) {
  const id = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | PublicToolView["status"]>("all");
  function relatedAgentName(tool: PublicToolView) {
    const publication = tool.publication;
    if (!publication) return null;
    const names = targets?.filter((option) => option.agentId.toLowerCase() === publication.agentId).map((option) => option.agentName.trim());
    if (!names?.length || names.some((value) => !value || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) || new Set(names).size !== 1) return null;
    return names[0];
  }
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visible = list?.tools.filter((tool) => (status === "all" || tool.status === status)
    && (displayName(tool.name).toLocaleLowerCase().includes(normalizedQuery) || tool.description.toLocaleLowerCase().includes(normalizedQuery)
      || Boolean(relatedAgentName(tool)?.toLocaleLowerCase().includes(normalizedQuery))));
  const filtered = Boolean(query) || status !== "all";
  const selectedHidden = list !== null && selectedId !== null && !visible?.some((tool) => tool.toolId === selectedId);

  function clearFilters() {
    setQuery(""); setStatus("all"); searchRef.current?.focus();
  }

  return <section aria-label="已读取工具清单" className="min-w-0 space-y-3">
    <h3 className="font-semibold">已读取的工具</h3>
    {currentUnknown ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">工具清单当前状态未知；{list ? "下面保留上次成功读取的快照，不代表本次读取成功或实时状态。" : "尚未得到可核对清单，不按零工具显示。"}已有操作仍以最后核对的工具修订检查，不自动写入或替换原调用。</p> : null}
    {list && visible ? <>
      <p className="text-sm text-slate-600">上次成功读取 {list.tools.length} 项{list.truncated ? "，清单已截断，仅包含前 100 项，不代表全部工具。" : "，不是持续更新的总数。"}</p>
      <div role="search" aria-label="工具清单查找" className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <label htmlFor={id + "-query"} className="block text-sm font-semibold text-slate-700">搜索工具或关联助手</label>
        <div className="relative min-w-0">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input ref={searchRef} id={id + "-query"} type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)}
            aria-describedby={id + "-scope"} placeholder="名称、说明或已核对的助手名称" className="h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </div>
        <div role="group" aria-label="工具开放状态" className="flex min-w-0 flex-wrap gap-2">
          {FILTERS.map((filter) => <button key={filter.value} type="button" aria-label={filter.accessibleLabel} aria-pressed={status === filter.value} onClick={() => setStatus(filter.value)}
            className={"inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 " + (status === filter.value ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100")}>
            {filter.label}<span className="rounded bg-white/80 px-1.5 py-0.5">{filter.value === "all" ? list.tools.length : list.tools.filter((tool) => tool.status === filter.value).length}</span>
          </button>)}
          {filtered ? <button type="button" onClick={clearFilters} className="min-h-9 px-2 text-xs font-semibold text-indigo-700 outline-none focus-visible:ring-2 focus-visible:ring-indigo-400">清除工具筛选</button> : null}
        </div>
        <p id={id + "-scope"} className="text-xs leading-5 text-slate-500">只筛选上次成功读取的名称、说明、状态和可核对的助手当前名称，不查询更多记录或改变工具。数量来自这份快照，不代表全部历史或实时状态。按助手归属核对名称，不改变工具的固定发布版本；来源不可读或名称冲突时不推断。</p>
        <p aria-live="polite" aria-atomic="true" className="text-xs text-slate-600">当前筛选显示 {visible.length} 项{list.truncated ? "，仅在已读取范围内查找。" : "。"}</p>
      </div>
      {selectedHidden ? <p className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">当前核对工具未显示在这份清单结果中。下方仍保留同一工具的填写与原请求，不会自动改选；可清除筛选或重新读取清单。</p> : null}
      {visible.length ? <ul className="grid min-w-0 gap-3 xl:grid-cols-2">{visible.map((tool) => <li key={tool.toolId} className="min-w-0 rounded-xl border border-slate-200 p-4">
        <h4 className="break-words font-semibold">{displayName(tool.name)}</h4>
        <p className="mt-1 break-words text-sm text-slate-600">{tool.description || "尚未填写说明"}</p>
        <p className="mt-2 text-xs text-slate-500">{TOOL_STATE[tool.status]}{tool.publication ? ` · 已绑定版本 ${tool.publication.version}` : " · 尚未绑定版本"}</p>
        {tool.publication ? <p className="mt-1 break-words text-xs text-slate-500">{relatedAgentName(tool) ? `关联助手（当前名称）：${relatedAgentName(tool)}` : "关联助手名称暂不可核对"}</p> : null}
        <button type="button" className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={locked}
          aria-label={`管理${displayName(tool.name)}`} onClick={() => onSelect(tool)}>管理这个工具</button>
      </li>)}</ul> : list.tools.length || filtered ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
        <h4 className="text-sm font-semibold text-slate-800">已读取范围内没有匹配的工具</h4>
        <p className="mt-2 text-xs leading-5 text-slate-500">请更改工具或助手名称、说明关键词，或清除状态筛选。{list.truncated ? "清单仅包含部分记录，不能据此判断其他工具不存在。" : "这里不是全部历史或实时工具状态。"}</p>
      </div> : <p role="status" className="text-sm text-slate-600">上次成功读取时没有工具；{currentUnknown ? "当前是否有工具仍待重新读取，不能按当前零记录处理。" : "可以先定义一个工具，但这不是持续更新的清单。"}</p>}
    </> : <p className="text-sm text-slate-600">{currentUnknown ? "请手动重新读取清单；不会用默认清单替代失败结果。" : "尚未读取工具清单，请输入管理凭据后手动读取；不会自动生成或发布工具。"}</p>}
  </section>;
}
