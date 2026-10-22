"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRight, Filter, Search, ShieldCheck } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToolRegistryDefinitionDetails } from "@/features/capabilities/ToolRegistryDefinitionDetails";
import { McpToolUseFilter, filterMcpRegisteredTools, mcpToolUseAgentHref } from "./mcp-tool-use-guide";

const emptyFilter: McpToolUseFilter = { query: "", risk: "all", operation: "all" };
const riskLabels = { low: "低风险", medium: "中风险", high: "高风险" } as const;
const fieldClass = "h-10 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400";

export function McpToolUseGuide({ tools, targets }: { tools: ToolRegistryOption[] | null; targets: AgentTargetOption[] | null }) {
  const instance = useId();
  const [filter, setFilter] = useState<McpToolUseFilter>(emptyFilter);
  const [toolId, setToolId] = useState("");
  const [versionId, setVersionId] = useState("");
  const registered = tools?.filter((tool) => tool.protocol === "mcp-streamable-http") ?? null;
  const visible = registered ? filterMcpRegisteredTools(registered, filter) : [];
  const selectedTool = registered?.find((tool) => tool.id === toolId);
  const selectedTarget = targets?.find((target) => target.versionId === versionId);
  const href = selectedTool && selectedTarget ? mcpToolUseAgentHref(selectedTarget.agentId) : null;
  const hasFilter = filter.query.trim() !== "" || filter.risk !== "all" || filter.operation !== "all";

  return <section aria-label="工具使用与影响" className="min-w-0 space-y-5">
    <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-950">
      <p className="flex items-center gap-2 font-semibold"><ShieldCheck aria-hidden="true" className="size-4 shrink-0" />登记、授权和使用是三件事</p>
      <p className="mt-1">本区读取已有登记，帮助你核对工具并进入助手的流程设计。选择不会保存绑定、授予账号权限或调用工具；修改流程仍须明确保存新草稿。</p>
    </div>
    <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <Card className="min-w-0">
        <CardHeader><CardTitle>选择登记工具</CardTitle><CardDescription>{registered === null ? "登记清单尚无法核对，不以零项代替读取失败。" : "本次读取了 " + registered.length + " 项远端工具登记；不是独立服务数量，也不代表连接或授权可用。"}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <label className="block space-y-1.5 text-xs font-medium text-slate-700"><span>搜索工具名称或说明</span><span className="relative block"><Search aria-hidden="true" className="absolute left-3 top-3 size-4 text-slate-400" /><input value={filter.query} maxLength={200} onChange={(event) => setFilter((value) => ({ ...value, query: event.target.value }))} disabled={registered === null} className={fieldClass + " pl-9"} placeholder="输入业务名称，不需要内部编号" /></span></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5 text-xs font-medium text-slate-700"><span>风险筛选</span><select value={filter.risk} disabled={registered === null} className={fieldClass} onChange={(event) => { const parsed = McpToolUseFilter.shape.risk.safeParse(event.target.value); if (parsed.success) setFilter((value) => ({ ...value, risk: parsed.data })); }}><option value="all">全部风险</option><option value="low">低风险</option><option value="medium">中风险</option><option value="high">高风险</option></select></label>
              <label className="block space-y-1.5 text-xs font-medium text-slate-700"><span>业务影响筛选</span><select value={filter.operation} disabled={registered === null} className={fieldClass} onChange={(event) => { const parsed = McpToolUseFilter.shape.operation.safeParse(event.target.value); if (parsed.success) setFilter((value) => ({ ...value, operation: parsed.data })); }}><option value="all">全部声明</option><option value="read">声明为读取</option><option value="action">声明可能改变数据</option><option value="undeclared">未声明读写分类</option></select></label>
            </div>
          </div>
          {registered === null ? <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">工具登记暂时无法读取。请使用页头的重新读取；填写连接设计不受影响。</div>
            : registered.length === 0 ? <div className="rounded-lg border border-dashed border-slate-200 p-5 text-sm leading-6 text-slate-500">本次没有远端工具登记。业务接口仍可在“登记与检查”核对；新连接设计不会自动产生工具。</div>
              : visible.length === 0 ? <div role="status" className="rounded-lg border border-dashed border-slate-200 p-5 text-sm leading-6 text-slate-500">没有符合筛选的登记工具。清除筛选可恢复清单，这不是连接失败。</div>
                : <fieldset className="space-y-2"><legend className="sr-only">选择一个登记工具</legend>{visible.map((tool) => <label key={tool.id} className={"flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition hover:border-indigo-200 " + (tool.id === toolId ? "border-indigo-300 bg-indigo-50/60" : "border-slate-200 bg-white")}>
                  <input type="radio" name={instance + "-tool"} value={tool.id} checked={tool.id === toolId} onChange={() => setToolId(tool.id)} aria-label={"选择" + tool.name} className="mt-1 accent-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-500" />
                  <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="break-words text-sm font-semibold text-slate-900">{tool.name}</span><Badge tone={tool.risk === "high" ? "danger" : tool.risk === "medium" ? "warning" : "neutral"}>{riskLabels[tool.risk]}</Badge></span>{tool.description ? <span className="mt-1 block break-words text-xs leading-5 text-slate-500">{tool.description}</span> : null}<span className="mt-2 block text-xs text-slate-600">{tool.operationKind === "read" ? "已声明为读取" : tool.operationKind === "action" ? "已声明可能改变外部数据" : "未声明读写分类"} · 已登记，不代表已授权</span></span>
                </label>)}</fieldset>}
          {hasFilter ? <Button type="button" variant="secondary" size="sm" onClick={() => setFilter(emptyFilter)}><Filter aria-hidden="true" className="size-3.5" />清除筛选</Button> : null}
          {selectedTool && !visible.some((tool) => tool.id === selectedTool.id) ? <p className="text-xs leading-5 text-indigo-700">已选工具“{selectedTool.name}”不在当前筛选内，选择仍保留。</p> : null}
        </CardContent>
      </Card>
      <Card className="min-w-0">
        <CardHeader><CardTitle>使用到助手</CardTitle><CardDescription>沿用现有工作方式编辑和新草稿保存，不直接修改已发布版本。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <ol aria-label="工具使用步骤" className="space-y-4 text-sm">
            <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">1</span><div className="min-w-0"><h3 className="font-semibold text-slate-900">核对工具与使用边界</h3><p className="mt-1 break-words leading-6 text-slate-500">{selectedTool ? selectedTool.name + "：" + (selectedTool.risk === "high" ? "高风险，进入流程后核对人工确认、业务键及权限。" : "先查看输入、结果和业务声明，再决定应用到哪一步。") : "从左侧选择本次读取的登记工具。"}</p></div></li>
            <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">2</span><div className="min-w-0 flex-1"><h3 className="font-semibold text-slate-900">选择要调整的助手</h3><label className="mt-2 block space-y-1.5 text-xs font-medium text-slate-700"><span>助手与正式版本</span><select value={selectedTarget ? versionId : ""} onChange={(event) => setVersionId(event.target.value)} disabled={targets === null || targets.length === 0} className={fieldClass} aria-describedby={instance + "-targets-note"}><option value="">请选择助手与版本</option>{targets?.map((target) => <option key={target.versionId} value={target.versionId}>{target.agentName + " · 正式版本 " + target.version}</option>)}</select></label><p id={instance + "-targets-note"} className="mt-2 text-xs leading-5 text-slate-500">{targets === null ? "助手版本暂时无法读取，不把失败当成没有助手。" : targets.length === 0 ? "本次没有可选择的正式版本，可先在助手工作台完成版本发布。" : "所选版本仅供核对来源，跳转后编辑该助手当前草稿，不会修改所选正式版本。"}</p></div></li>
            <li className="flex gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">3</span><div className="min-w-0"><h3 className="font-semibold text-slate-900">在流程步骤中选择工具</h3><p className="mt-1 leading-6 text-slate-500">打开流程设计，选择或新增工具步骤，再选择已登记工具。明确保存草稿、核对设计和试运行后，按原流程生成新版本。</p></div></li>
          </ol>
          {toolId && !selectedTool ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">已选工具无法在本次登记中核对，请重新选择；没有自动换成其他工具。</p> : null}
          {versionId && !selectedTarget ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">已选版本无法在本次清单中核对，请重新选择；没有打开其他助手。</p> : null}
          {href ? <Link href={href} prefetch={false} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">进入助手流程设计<ArrowRight aria-hidden="true" className="size-4" /></Link> : <Button type="button" disabled>进入助手流程设计</Button>}
          <Link href="/agents" prefetch={false} className="ml-3 inline-block text-sm font-medium text-indigo-700 hover:underline">查看全部助手</Link>
          <p className="text-xs leading-5 text-slate-500">这里只导航，不会自动绑定所选工具。账号授权和版本权限仍须真实核对，本页选择不增加任何权限。</p>
        </CardContent>
      </Card>
    </div>
    {selectedTool ? <Card className="min-w-0"><CardHeader><CardTitle>{selectedTool.name + "的使用边界"}</CardTitle><CardDescription>只展示本次服务端登记，不推测远端发现结果或实际执行映射。</CardDescription></CardHeader><CardContent className="min-w-0 text-sm leading-6 text-slate-600"><ToolRegistryDefinitionDetails key={selectedTool.id} tool={selectedTool} /></CardContent></Card> : null}
    <Card><CardHeader><CardTitle>授权与影响范围</CardTitle><CardDescription>尚未接入账号授权、真实依赖影响和执行实现矩阵查询；这些状态不能从登记或风险标签推导。</CardDescription></CardHeader><CardContent>
      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{["账号授权", "关联助手与自动计划", "近期任务影响", "工具执行实现"].map((label) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 text-sm font-semibold text-slate-700">未读取</dd></div>)}</dl>
      <p className="mt-3 text-xs leading-5 text-slate-500">未读取不等于没有影响或全部可用。真实连接检查仍在“登记与检查”，本区不把该检查替代业务权限、依赖影响或执行验证。</p>
    </CardContent></Card>
  </section>;
}
