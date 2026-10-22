"use client";

import { useId } from "react";
import { InputBinding, InputMapping, InputValueSource, MAX_INPUT_BINDINGS } from "@/contracts/input-mapping";
import { isPassiveJsonData } from "@/contracts/json";
import { ToolOperationConfig } from "@/contracts/tool-operation";
import { ModelOutputConfig, MAX_MODEL_MOCK_OUTPUT_BYTES, MAX_MODEL_OUTPUT_REPAIRS, MAX_MODEL_OUTPUT_SCHEMA_BYTES } from "@/contracts/model-output";
import { MAX_SUBFLOW_STEPS, MAX_PARALLEL_BRANCHES, MAX_PARALLEL_STEPS, MAX_WORKFLOW_BYTES, WorkflowNode, type WorkflowDraft } from "@/contracts/workflow";
import { validateModelOutputConfiguration } from "@/server/domain/runtime/model-output";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { redactSensitiveText, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";
import { QualityGateReview } from "@/features/workflow-canvas/QualityGateReview";
import { AiReworkLimitReview } from "@/features/workflow-canvas/AiReworkLimitReview";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function displayText(value: unknown, fallback: string, identifiers: Set<string>): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  let text = redactSensitiveText(value);
  for (const id of [...identifiers].sort((a, b) => b.length - a.length)) if (id) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`, "g"), "$1[内部标识已隐藏]");
  }
  return text;
}

function displayData(value: unknown, identifiers: Set<string>): unknown {
  function hide(item: unknown): unknown {
    if (typeof item === "string") return displayText(item, "", identifiers);
    if (Array.isArray(item)) return item.map(hide);
    const object = record(item);
    return object ? Object.fromEntries(Object.entries(object).map(([key, child]) => [displayText(key, "", identifiers), hide(child)])) : item;
  }
  return hide(redactStructuredCredentialData(value));
}

function savedSources(workflow: WorkflowDraft | undefined, identifiers: Set<string>) {
  const sources = new Map<string, string[]>();
  const add = (id: string, context: string) => { identifiers.add(id); sources.set(id, [...sources.get(id) ?? [], context]); };
  if (!workflow || !isPassiveJsonData(workflow, MAX_WORKFLOW_BYTES) || !record(workflow.nodes)) return sources;
  identifiers.add(workflow.id);
  if (workflow.versionId) identifiers.add(workflow.versionId);
  if (workflow.rootAgent?.id) identifiers.add(workflow.rootAgent.id);
  for (const [key, node] of Object.entries(workflow.nodes)) {
    if (!record(node)) continue;
    identifiers.add(key);
    if (typeof node.id === "string") identifiers.add(node.id);
    if (!WorkflowNode.safeParse(node).success || key !== node.id) continue;
    const title = displayText(node.title, "未保存步骤名称", identifiers);
    add(node.id, `顶层步骤：${title}`);
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (prepared.ok) for (const [index, step] of prepared.steps.entries()) {
        const original = node.subflow!.steps[index];
        add(step.id, `步骤组：${displayText(node.subflow!.name, title, identifiers)} · ${displayText(original.title, `第${index + 1}项未保存步骤名称`, identifiers)}`);
      }
    } else if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (prepared.ok) for (const [branchIndex, branch] of prepared.branches.entries()) {
        identifiers.add(branch.id);
        const original = node.parallel!.branches[branchIndex];
        for (const [index, step] of branch.steps.entries()) add(step.id, `并行步骤：${title} · 分支：${displayText(original.label, "未保存分支名称", identifiers)} · ${displayText(original.steps[index].title, `第${index + 1}项未保存步骤名称`, identifiers)}`);
      }
    }
  }
  return sources;
}

function SavedValue({ value, label, identifiers }: { value: unknown; label: string; identifiers: Set<string> }) {
  const summary = value === null ? "空值" : value === "" ? "空字符串" : typeof value === "boolean" ? value ? "是" : "否" : typeof value === "number" ? String(value) : typeof value === "string" ? displayText(value, "空字符串", identifiers) : Array.isArray(value) ? "已保存的列表" : "已保存的对象";
  return <div className="space-y-1"><p className="break-words text-xs leading-5 text-slate-700">{label}：{summary}</p><details className="rounded-lg bg-slate-50 p-2"><summary className="cursor-pointer text-xs text-slate-600">开发者原值（脱敏只读）</summary><pre aria-label={label + "原值"} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(displayData(value, identifiers), null, 2)}</pre></details></div>;
}

function ModelDefinition({ original, identifiers }: { original: Record<string, unknown>; identifiers: Set<string> }) {
  if (!Object.hasOwn(original, "modelOutput")) return <p className="text-xs text-slate-500">未保存模型结果字段约定，不补造规则或模拟样例。</p>;
  const raw = record(original.modelOutput);
  const safe = raw && isPassiveJsonData(raw, MAX_MODEL_OUTPUT_SCHEMA_BYTES + MAX_MODEL_MOCK_OUTPUT_BYTES + 4096);
  if (!safe) return <p role="status" className="text-xs text-amber-900">原模型结果约定无法安全展示，保持只读并保留原定义。</p>;
  const parsed = ModelOutputConfig.safeParse(raw);
  const unknownKeys = Object.keys(raw).some((key) => !Object.hasOwn(ModelOutputConfig.shape, key));
  const applicable = parsed.success && WorkflowNode.safeParse({ ...original, id: "readonly", title: "已保存步骤", modelOutput: parsed.data, inputMapping: undefined }).success;
  const valid = parsed.success && applicable && validateModelOutputConfiguration({ title: "已保存步骤", modelOutput: parsed.data }) === null;
  return <div className="space-y-2">
    {unknownKeys || !valid ? <p role="status" className="text-xs leading-5 text-amber-900">原约定含未知、不适用或未通过当前规则核对的内容。保持只读并保留原定义，不替换或补写默认值。</p> : null}
    <dl className="grid gap-2 text-xs leading-5 text-slate-600">
      <div><dt className="font-semibold text-slate-800">原保存格式</dt><dd>{raw.format === "json" ? "对象数据格式" : Object.hasOwn(raw, "format") ? "原格式无法识别，保留原定义" : "未保存格式"}</dd></div>
      <div><dt className="font-semibold text-slate-800">原保存请求方式</dt><dd>{raw.providerMode === "json-schema" ? "向模型服务提交字段规则" : raw.providerMode === "json" ? "按对象格式请求" : Object.hasOwn(raw, "providerMode") ? "原请求方式无法识别，保留原定义" : "未保存请求方式，不以默认方式替代原定义"}</dd></div>
      <div><dt className="font-semibold text-slate-800">原保存修正上限</dt><dd>{Number.isInteger(raw.maxRepairAttempts) && typeof raw.maxRepairAttempts === "number" && raw.maxRepairAttempts >= 0 && raw.maxRepairAttempts <= MAX_MODEL_OUTPUT_REPAIRS ? raw.maxRepairAttempts === 0 ? "不作额外格式修正" : `最多额外修正${raw.maxRepairAttempts}次` : Object.hasOwn(raw, "maxRepairAttempts") ? "原修正上限无法识别，保留原定义" : "未保存额外修正次数，不补写默认次数"}</dd></div>
    </dl>
    {Object.hasOwn(raw, "schema") ? <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">开发者原字段规则（脱敏只读）</summary><pre aria-label="原模型字段规则" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(displayData(raw.schema, identifiers), null, 2)}</pre></details> : <p className="text-xs text-amber-900">原约定没有保存字段规则。</p>}
    {Object.hasOwn(raw, "mockOutput") ? <details className="rounded-lg border border-amber-200 p-3"><summary className="cursor-pointer text-xs font-semibold text-amber-900">开发者测试区：原模拟样例</summary><p className="mt-2 text-xs leading-5 text-amber-900">仅后端模拟模式采用此样例；它不是真实运行结果或默认模型输出。此处只读核对，不创建或替换样例。</p><pre aria-label="原模型模拟样例" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(displayData(raw.mockOutput, identifiers), null, 2)}</pre></details> : null}
    <p className="text-xs leading-5 text-slate-500">字段约定与有限格式修正不证明业务质量，也不证明当前模型服务支持或已经执行。</p>
  </div>;
}

function MappingDefinition({ original, identifiers, sources }: { original: Record<string, unknown>; identifiers: Set<string>; sources: Map<string, string[]> }) {
  if (!Object.hasOwn(original, "inputMapping")) return <p className="text-xs text-slate-500">未保存输入映射，不补造来源或接收字段。</p>;
  const mapping = record(original.inputMapping);
  if (!mapping || !isPassiveJsonData(mapping, MAX_WORKFLOW_BYTES)) return <p role="status" className="text-xs text-amber-900">原输入映射无法安全展示，保持只读并保留原定义。</p>;
  const parsed = InputMapping.safeParse(mapping);
  const applicable = parsed.success && WorkflowNode.safeParse({ ...original, id: "readonly", title: "已保存步骤", modelOutput: undefined, inputMapping: parsed.data }).success;
  const fields = Array.isArray(mapping.fields) ? mapping.fields.slice(0, MAX_INPUT_BINDINGS) : [];
  return <div className="space-y-2">
    {!parsed.success || !applicable ? <p role="status" className="text-xs text-amber-900">原输入映射含未知、不适用或无法识别的配置，保持只读并保留原定义。</p> : null}
    <p className="text-xs leading-5 text-slate-600">{mapping.includeUpstreamOutputs === true ? "原设置额外携带全部上游成果。" : mapping.includeUpstreamOutputs === false ? "原设置不额外携带全部上游成果。" : "未保存全部上游成果携带设置，不补写默认值。"} 来源名称只说明保存的关联，不证明实际执行、执行顺序或当前可读数据。</p>
    {fields.length ? <ol className="space-y-3">{fields.map((item, index) => {
      const binding = record(item);
      const valid = InputBinding.safeParse(item);
      if (!binding || !valid.success) return <li key={index} className="rounded-lg border border-amber-200 p-3 text-xs text-amber-900">第{index + 1}项映射无法识别；原定义只读保留，不补造目标或来源。</li>;
      const source = record(binding.source)!;
      const contexts = valid.data.source.kind === "output" ? sources.get(valid.data.source.nodeId) : undefined;
      const context = contexts?.length === 1 ? displayText(contexts[0], "未保存来源名称", identifiers) : contexts?.length ? "保存的关联对应多个步骤，无法唯一定位来源。" : "未能在提供的冻结流程中定位来源；保留原关联，不按名称或位置猜测。";
      return <li key={index} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-800">接收字段{index + 1} · {valid.data.target.length}层目标字段</p>
        <p className="text-xs text-slate-600">{binding.required === true ? "原设置要求提供" : binding.required === false ? "原设置允许缺失" : "未保存是否必须提供，不补写默认值"}</p>
        {source.kind === "literal" ? <SavedValue label="固定值" value={source.value} identifiers={identifiers} /> : <p className="break-words text-xs leading-5 text-slate-700">{source.kind === "input" ? "来源：原任务输入" : `来源：${context}`} · {Object.hasOwn(source, "path") ? Array.isArray(source.path) && source.path.length === 0 ? "原设置取整个来源" : `取${valid.data.source.kind !== "literal" ? valid.data.source.path.length : 0}层来源字段` : "未保存来源字段层级，不补造默认层级"}</p>}
        <details className="rounded-lg bg-slate-50 p-2"><summary className="cursor-pointer text-xs text-slate-600">开发者原字段层级（脱敏只读）</summary><p className="mt-2 text-xs leading-5 text-slate-500">按保存的分段列表核对；含句点的字段名仍是一个层级，不拆分或合并。</p><dl className="mt-2 space-y-2 text-xs"><div><dt>原目标层级</dt><dd><pre aria-label="原映射目标层级" className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(displayData(binding.target, identifiers))}</pre></dd></div>{Object.hasOwn(source, "path") ? <div><dt>原来源层级</dt><dd><pre aria-label="原映射来源层级" className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(displayData(source.path, identifiers))}</pre></dd></div> : null}</dl></details>
        {Object.hasOwn(binding, "fallback") ? <SavedValue label="来源缺失时的原固定值" value={binding.fallback} identifiers={identifiers} /> : <p className="text-xs text-slate-500">未保存来源缺失时的固定值。</p>}
      </li>;
    })}</ol> : <p className="text-xs text-slate-500">原定义未保存映射条目，不补造字段。</p>}
    {Array.isArray(mapping.fields) && mapping.fields.length > MAX_INPUT_BINDINGS ? <p role="status" className="text-xs text-amber-900">原条目数量超过当前约定，仅展示前{MAX_INPUT_BINDINGS}项；全部原定义保留。</p> : null}
  </div>;
}

function ToolOperationDefinition({ original, identifiers, sources }: { original: Record<string, unknown>; identifiers: Set<string>; sources: Map<string, string[]> }) {
  if (!Object.hasOwn(original, "toolOperation")) return <p className="text-xs text-slate-500">未保存工具防重设置，不补造业务范围或标识来源。</p>;
  const raw = record(original.toolOperation);
  if (!raw || !isPassiveJsonData(raw, MAX_WORKFLOW_BYTES)) return <p role="status" className="text-xs text-amber-900">原工具防重设置无法安全展示，保持只读并保留原定义。</p>;
  const parsed = ToolOperationConfig.safeParse(raw);
  const applicable = parsed.success && WorkflowNode.safeParse({ ...original, id: "readonly", title: "已保存步骤", modelOutput: undefined, inputMapping: undefined, toolOperation: parsed.data }).success;
  const scope = ToolOperationConfig.shape.scope.safeParse(raw.scope);
  const key = record(raw.key);
  const source = InputValueSource.safeParse(key);
  const contexts = source.success && source.data.kind === "output" ? sources.get(source.data.nodeId) : undefined;
  const context = contexts?.length === 1 ? displayText(contexts[0], "未保存来源名称", identifiers) : contexts?.length ? "保存的关联对应多个步骤，无法唯一定位来源。" : "未能在提供的冻结流程中定位来源；保留原关联，不按名称或位置猜测。";
  return <div className="space-y-2">
    {!parsed.success || !applicable ? <p role="status" className="text-xs leading-5 text-amber-900">原工具防重设置含未知、不适用或无法识别的内容，保持只读并保留原定义，不修复或重新绑定。</p> : null}
    <p className="text-xs leading-5 text-slate-700">原业务范围：{scope.success ? "已保存，具体原值在下方开发者数据核对" : Object.hasOwn(raw, "scope") ? "无法按当前约定识别，保留原定义" : "未保存，不补造范围"}。</p>
    {source.success && key ? source.data.kind === "literal" ? <SavedValue label="原业务标识固定值" value={key.value} identifiers={identifiers} /> : <div className="space-y-2">
      <p className="break-words text-xs leading-5 text-slate-700">{source.data.kind === "input" ? "业务标识来源：原任务输入" : `业务标识来源：${context}`} · {Object.hasOwn(key, "path") ? source.data.path.length === 0 ? "原设置取整个来源" : `取${source.data.path.length}层来源字段` : "未保存来源字段层级，不补造默认层级"}</p>
      {Object.hasOwn(key, "path") ? <details className="rounded-lg bg-slate-50 p-2"><summary className="cursor-pointer text-xs text-slate-600">开发者原业务标识层级（脱敏只读）</summary><p className="mt-2 text-xs leading-5 text-slate-500">按保存的分段列表核对，含句点的字段名仍是一个层级，不拆分或合并。</p><pre aria-label="原业务标识来源层级" className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(displayData(key.path, identifiers))}</pre></details> : null}
    </div> : <p role="status" className="text-xs text-amber-900">原业务标识来源无法识别或没有保存，保留原定义，不生成标识或猜测来源。</p>}
    <p className="text-xs leading-5 text-slate-500">业务标识在运行时必须是非空短文字或安全整数；零可以作为整数，否、空值、对象和列表不能作为业务标识。这里不读取实际任务数据，也不验证运行时取值。</p>
    <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">开发者原工具防重定义（脱敏只读）</summary><pre aria-label="原工具防重定义" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(displayData(raw, identifiers), null, 2)}</pre></details>
    <p className="text-xs leading-5 text-slate-500">仅核对冻结快照，不查询当前工具登记或补写有效期；已保存配置不证明当前连接、权限、防重能力或实际执行结果。此处不保存、重发或调用工具。</p>
  </div>;
}

function ContractSections({ original, identifiers, sources, workflow, inline = false, onLocateStep }: { original: Record<string, unknown>; identifiers: Set<string>; sources: Map<string, string[]>; workflow?: WorkflowDraft; inline?: boolean; onLocateStep?: (id: string) => void }) {
  return <div className="space-y-4"><div className="space-y-2"><h4 className="text-sm font-semibold text-slate-900">已保存的模型结果约定</h4><ModelDefinition original={original} identifiers={identifiers} /></div><div className="space-y-2"><h4 className="text-sm font-semibold text-slate-900">已保存的输入映射</h4><MappingDefinition original={original} identifiers={identifiers} sources={sources} /></div>{original.type === "tool" || Object.hasOwn(original, "toolOperation") ? <div className="space-y-2"><h4 className="text-sm font-semibold text-slate-900">已保存的工具防重设置</h4><ToolOperationDefinition original={original} identifiers={identifiers} sources={sources} /></div> : null}{original.type === "ai" ? <AiReworkLimitReview originalNode={original} inline={inline} /> : null}{original.type === "rule" || Object.hasOwn(original, "quality") ? <QualityGateReview originalNode={original} originalWorkflow={workflow} inline={inline} onLocateStep={inline ? undefined : onLocateStep} /> : null}</div>;
}

export function FrozenNodeContracts({ node, workflow, onLocateStep }: { node: WorkflowNode; workflow?: WorkflowDraft; onLocateStep?: (id: string) => void }) {
  const heading = useId();
  if (!isPassiveJsonData(node, MAX_WORKFLOW_BYTES)) return <section aria-label="冻结字段约定只读核对"><p role="status" className="text-xs text-amber-900">步骤包含无法安全读取的内容，原字段约定只读保留，未读取或补造配置。</p></section>;
  const identifiers = new Set<string>([node.id]);
  const sources = savedSources(workflow, identifiers);
  const subflow = record(node.subflow), parallel = record(node.parallel);
  const groups = node.type === "subflow" && Array.isArray(subflow?.steps) ? [{ title: subflow.name, steps: subflow.steps, limit: MAX_SUBFLOW_STEPS }]
    : node.type === "parallel" && Array.isArray(parallel?.branches) ? parallel.branches.slice(0, MAX_PARALLEL_BRANCHES).flatMap((item) => {
      const branch = record(item);
      if (typeof branch?.id === "string") identifiers.add(branch.id);
      return branch && Array.isArray(branch.steps) ? [{ title: branch.label, steps: branch.steps, limit: MAX_PARALLEL_STEPS }] : [];
    }) : [];
  for (const group of groups) for (const step of group.steps) {
    const original = record(step);
    if (typeof original?.id === "string") identifiers.add(original.id);
    const mapping = record(original?.inputMapping);
    for (const field of Array.isArray(mapping?.fields) ? mapping.fields : []) { const source = record(record(field)?.source); if (typeof source?.nodeId === "string") identifiers.add(source.nodeId); }
  }
  for (const original of [node, ...groups.flatMap((group) => group.steps)].map(record)) {
    const key = record(record(original?.toolOperation)?.key);
    const tool = record(original?.tool);
    if (typeof key?.nodeId === "string") identifiers.add(key.nodeId);
    if (typeof tool?.registryToolId === "string") identifiers.add(tool.registryToolId);
  }
  const mapping = record(node.inputMapping);
  for (const field of Array.isArray(mapping?.fields) ? mapping.fields : []) { const source = record(record(field)?.source); if (typeof source?.nodeId === "string") identifiers.add(source.nodeId); }
  return <section aria-labelledby={heading} className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-4">
    <div><h3 id={heading} className="text-sm font-semibold text-slate-950">冻结字段约定只读核对</h3><p className="mt-1 text-xs leading-5 text-slate-500">仅展示提供的原定义。敏感文本与内部标识在展示时隐藏；原配置不修改，不补默认值，不保存、试算或运行。</p></div>
    {workflow && !isPassiveJsonData(workflow, MAX_WORKFLOW_BYTES) ? <p role="status" className="text-xs leading-5 text-amber-900">提供的流程含无法安全核对的内容，保持只读，来源不作定位。</p> : null}
    <ContractSections original={node} identifiers={identifiers} sources={sources} workflow={workflow} onLocateStep={onLocateStep} />
    {node.type === "subflow" && subflow && !Array.isArray(subflow.steps) || node.type === "parallel" && parallel && (!Array.isArray(parallel.branches) || parallel.branches.length > MAX_PARALLEL_BRANCHES || parallel.branches.some((branch) => !Array.isArray(record(branch)?.steps))) ? <p role="status" className="text-xs text-amber-900">原组结构不完整或超过当前约定，不能完整定位；原定义只读保留，不补造组内步骤。</p> : null}
    {groups.length ? <div className="space-y-3"><h4 className="text-sm font-semibold text-slate-900">组内原字段约定</h4>{groups.map((group, groupIndex) => <details key={groupIndex} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer break-words text-xs font-semibold text-slate-700">{displayText(group.title, "未保存组名称", identifiers)} · {group.steps.length}项已保存步骤</summary><ol className="mt-3 space-y-4">{group.steps.slice(0, group.limit).map((step, index) => {
      const original = record(step);
      return <li key={index} className="space-y-3 border-t border-slate-100 pt-3"><p className="break-words text-xs font-semibold text-slate-800">第{index + 1}项 · {displayText(original?.title, "未保存步骤名称", identifiers)}</p>{original ? <ContractSections original={original} identifiers={identifiers} sources={sources} workflow={workflow} inline /> : <p className="text-xs text-amber-900">原步骤格式无法识别，保持只读并保留原定义。</p>}</li>;
    })}</ol>{group.steps.length > group.limit ? <p role="status" className="mt-2 text-xs text-amber-900">原组步骤超过当前约定，仅展示前{group.limit}项，全部原定义保留。</p> : null}<p className="mt-3 text-xs leading-5 text-slate-500">直接核对组内原定义，不用准备函数解析后的默认值替代原配置。这里没有实际运行成果。</p></details>)}</div> : null}
  </section>;
}
