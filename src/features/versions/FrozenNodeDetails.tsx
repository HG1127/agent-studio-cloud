import { outgoingSpecs } from "@/features/workflow-canvas/flow-edges";
import { NODE_TYPE_LABELS } from "@/features/workflow-canvas/CustomNodes";
import { LoopPathOverview } from "@/features/workflow-canvas/LoopPathOverview";
import { recordedBusinessObjective } from "@/features/workflow-canvas/business-evidence";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { CopyResultButton } from "@/features/runs/CopyResultButton";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { frozenStep } from "./frozen-workflow-view";
import { FrozenNodeContracts } from "./FrozenNodeContracts";

const ROLE_LABELS: Record<string, string> = { owner: "业务负责人", builder: "流程设计人员", operator: "执行人员", viewer: "查看人员", manager: "业务负责人" };
const HANDOFF_TYPES = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表", any: "不限格式" } as const;
export function FrozenNodeDetails({ node, workflow, onSelect }: { node: WorkflowNode; workflow: WorkflowDraft; onSelect: (id: string) => void }) {
  const objective = recordedBusinessObjective(node);
  const routes = outgoingSpecs(node);
  const groups = node.parallel?.branches.map((branch) => ({ title: branch.label, steps: branch.steps }))
    ?? (node.subflow ? [{ title: node.subflow.name || "步骤组", steps: node.subflow.steps }] : []);
  return <section aria-labelledby="frozen-node-title" className="content-card min-w-0 space-y-4">
    <div><p className="eyebrow">只读步骤核对</p><h2 id="frozen-node-title" tabIndex={-1} className="mt-1 break-words text-lg font-semibold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500">{node.title || "未命名步骤"}</h2><p className="mt-1 text-xs text-slate-500">{NODE_TYPE_LABELS[node.type]}{isHiddenControlNode(node) ? " · 系统检查步骤" : ""}</p></div>
    {node.description ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{node.description}</p> : null}
    {objective ? <div className="rounded-lg bg-indigo-50 p-3 text-sm leading-6 text-indigo-950"><span className="font-semibold">已记录业务目标：</span>{objective}</div> : null}
    {node.purpose ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{node.purpose.trim() === "execute" ? "处理要求为通用标记，详见下方开发者设置。" : <>处理要求：{node.purpose}</>}</p> : null}
    {node.approval ? <div className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950"><p>确认角色：{Object.hasOwn(ROLE_LABELS, node.approval.role) ? ROLE_LABELS[node.approval.role] : /\p{Script=Han}/u.test(node.approval.role) ? node.approval.role : "已配置角色，详见开发者设置"}</p><p className="mt-1 break-words">{node.approval.reason || "未保存确认说明"}</p></div> : null}
    {node.tool ? <p className="rounded-lg bg-sky-50 p-3 text-xs leading-5 text-sky-950">{node.tool.unresolved ? "已保存工具要求，但未冻结有效绑定。" : node.tool.protocol === "demo" ? "已冻结演示工具设置，不是实际业务连接。" : !node.tool.registryToolId ? "已保存工具要求，但未冻结有效绑定。" : "已冻结工具绑定；当前连接、权限和执行可用性未在此核对。"} 风险：{{ low: "低", medium: "中", high: "高" }[node.tool.risk]}。</p> : null}
    {node.retry && node.type !== "ai" ? <p className="text-xs leading-5 text-slate-500">原尝试设置：最多 {node.retry.maxAttempts} 次，等待参数 {node.retry.backoffMs} 毫秒。这里只展示配置，不证明当前执行器采用该等待参数或运行已重试。</p> : null}
    <div><h3 className="text-sm font-semibold text-slate-900">已保存的后续路径</h3>{routes.length ? <ul className="mt-2 space-y-2">{routes.map((route) => <li key={route.handle} className="flex min-w-0 items-start justify-between gap-2 rounded-lg border border-slate-200 p-2 text-xs"><span className="break-words text-slate-500">{route.label || "完成后"}</span>{frozenStep(workflow, route.target) ? <button type="button" onClick={() => onSelect(route.target)} className="min-w-0 break-words text-right font-semibold text-indigo-700 hover:underline">{frozenStep(workflow, route.target)!.title || "未命名步骤"}</button> : <span className="text-amber-800">关联步骤未找到</span>}</li>)}</ul> : <p className="mt-2 text-xs leading-5 text-slate-500">此步没有已保存的后续路径。不据此判断是否能通过发布检查。</p>}</div>
    {groups.length ? <div className="space-y-2"><h3 className="text-sm font-semibold text-slate-900">组内已保存步骤</h3>{groups.map((group, groupIndex) => <details key={groupIndex} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer break-words text-xs font-semibold text-slate-700">{group.title || "步骤组"} · {group.steps.length} 项</summary><ol className="mt-2 space-y-1 text-xs leading-5 text-slate-600">{group.steps.map((step, index) => <li key={index}>{index + 1} · {typeof step.title === "string" && step.title.trim() ? step.title : "未保存步骤名称"}</li>)}</ol><p className="mt-2 text-xs text-slate-500">组内设置保留在下方开发者数据中；画布只展示顶层流程。</p></details>)}</div> : null}
    <FrozenNodeContracts node={node} workflow={workflow} onLocateStep={onSelect} />
    {node.type === "loop" ? <LoopPathOverview nodeId={node.id} nodes={workflow.nodes} mode="frozen" onFocusNode={onSelect} /> : null}
    <details aria-label="脱敏冻结步骤设置" className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">查看脱敏步骤设置（开发者数据）</summary><div className="mt-3 space-y-3"><CopyResultButton key={node.id} result={node} label="复制脱敏步骤设置" /><pre aria-label="冻结步骤设置内容" className="max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">{JSON.stringify(node, null, 2)}</pre><p className="text-xs leading-5 text-slate-500">常见敏感信息已隐藏，深层内容可能省略；此处不是完整数据安全审查。</p></div></details>
    {node.agentCall || node.toAgent ? <p className="rounded-lg bg-indigo-50 p-3 text-xs leading-5 text-indigo-950">已冻结协作目标：{node.agentCall?.targetAgentName || node.toAgent?.name || "未保存助手名称"}。目标版本与权限是否当前可用未在此核对，不替换成其他助手或新版本。</p> : null}
    {node.contract ? <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-medium text-slate-600">核对已冻结交接约定</summary><div className="mt-3 space-y-3 text-xs leading-5 text-slate-600">
      {[{ title: "必须交付", values: node.contract.deliverables }, { title: "禁止带入", values: node.contract.mustNotInclude }].map((group) => <div key={group.title}><h3 className="font-semibold text-slate-800">{group.title}</h3>{group.values.length ? <ul className="mt-1 list-disc space-y-1 pl-4">{group.values.map((value, index) => <li key={index} className="break-words">{value}</li>)}</ul> : <p>没有保存条目，不补造约定。</p>}</div>)}
      {[{ title: "接收字段", fields: node.contract.inputSchema }, { title: "交付字段", fields: node.contract.outputSchema }].map((group) => <div key={group.title}><h3 className="font-semibold text-slate-800">{group.title}</h3>{group.fields.length ? <ul className="mt-1 space-y-1">{group.fields.map((field, index) => <li key={index}>{field.label?.trim() || "字段 " + (index + 1)} · {HANDOFF_TYPES[field.type]} · {field.required ? "必须提供" : "可选"}</li>)}</ul> : <p>没有保存结构化字段。</p>}</div>)}
      <p>经验传递：{node.contract.memoryPolicy ? { none: "不传入经验", self: "仅使用接收助手自身经验", team: "允许传入上游经验" }[node.contract.memoryPolicy.mode] : "没有保存明确设置"}。这不是正式团队共享授权；字段白名单与禁止字段在开发者设置核对。</p>
    </div></details> : null}
  </section>;
}
