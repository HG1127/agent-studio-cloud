import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { auditWorkflow, type AuditIssue } from "./design-auditor";

export interface SafeAuditFixResult {
  draft: WorkflowDraft;
  applied: string[];
  skipped: string[];
  remainingCritical: number;
  remainingWarnings: number;
}

function uniqueId(nodes: Record<string, WorkflowNode>, base: string): string {
  let id = base;
  let index = 2;
  while (nodes[id]) id = `${base}_${index++}`;
  return id;
}

function outgoing(node: WorkflowNode): string[] {
  return [
    node.next,
    node.rejectNext,
    node.onErrorNext,
    ...(node.condition?.branches.map((branch) => branch.next) ?? []),
    node.condition?.defaultNext,
    node.loop?.bodyNext,
    node.loop?.exitNext,
    node.wait?.onTimeoutNext,
  ].filter((value): value is string => Boolean(value));
}

function redirectReferences(nodes: Record<string, WorkflowNode>, from: string, to: string | null): void {
  for (const node of Object.values(nodes)) {
    if (node.next === from) node.next = to;
    if (node.rejectNext === from) node.rejectNext = to;
    if (node.onErrorNext === from) node.onErrorNext = to;
    if (node.condition) {
      node.condition.branches = node.condition.branches.map((branch) => branch.next === from ? { ...branch, next: to } : branch);
      if (node.condition.defaultNext === from) node.condition.defaultNext = to;
    }
    if (node.loop) {
      if (node.loop.bodyNext === from) node.loop.bodyNext = to;
      if (node.loop.exitNext === from) node.loop.exitNext = to;
    }
    if (node.wait?.onTimeoutNext === from) node.wait.onTimeoutNext = to;
  }
}

function firstEnd(nodes: Record<string, WorkflowNode>): WorkflowNode | undefined {
  return Object.values(nodes).find((node) => node.type === "end");
}

function isBusinessOutputSource(node: WorkflowNode): boolean {
  return node.type !== "trigger"
    && node.type !== "end"
    && node.ui?.visibility !== "control"
    && node.controlPlane?.hiddenByDefault !== true;
}

function safeFixIssue(draft: WorkflowDraft, issue: AuditIssue, applied: string[], skipped: string[]): void {
  const nodes = draft.nodes;
  const node = issue.nodeId ? nodes[issue.nodeId] : undefined;
  let end = firstEnd(nodes);
  if (issue.code === "start_missing") {
    const start = Object.values(nodes).find((item) => item.type === "trigger") ?? Object.values(nodes)[0];
    if (start) {
      draft.startNodeId = start.id;
      applied.push("修复流程启动节点");
    } else skipped.push(issue.title);
    return;
  }
  if (issue.code === "end_missing") {
    const id = uniqueId(nodes, "done");
    nodes[id] = WorkflowNode.parse({ id, title: "本次任务完成", type: "end", next: null });
    end = nodes[id];
    for (const item of Object.values(nodes)) {
      if (item.id !== id && item.type !== "end" && item.type !== "subflow" && outgoing(item).length === 0) item.next = id;
    }
    applied.push("补充完成节点并接回现有死路");
    return;
  }
  if (issue.code === "output_contract_missing" || issue.code === "output_contract_source_invalid") {
    const candidates = Object.values(nodes).filter(isBusinessOutputSource);
    const source = candidates.find((item) => item.next === end?.id) ?? candidates.at(-1);
    if (source) {
      const fields = draft.outputContract?.fields ?? [];
      draft.outputContract = {
        fields: fields.length === 0
          ? [{ path: source.id, label: source.title, required: true, sourceNodeId: source.id }]
          : fields.map((field) => {
              const current = field.sourceNodeId ? nodes[field.sourceNodeId] : undefined;
              return current && isBusinessOutputSource(current) ? field : { ...field, sourceNodeId: source.id };
            }),
      };
      applied.push(issue.code === "output_contract_missing"
        ? `把「${source.title}」声明为最终交付物`
        : `把失效的最终交付来源改为「${source.title}」`);
    } else skipped.push(issue.title);
    return;
  }
  if (issue.code === "end_without_delivery" && node?.type === "end") {
    const id = uniqueId(nodes, `deliver_${node.id}`);
    redirectReferences(nodes, node.id, id);
    nodes[id] = WorkflowNode.parse({
      id, title: "整理最终结果", type: "system", next: node.id,
      system: { kind: "deliver_output" }, description: "整理本次运行中已形成的业务结果",
      controlPlane: { kind: "delivery", hiddenByDefault: true }, ui: { visibility: "control" },
    });
    applied.push(`在「${node.title}」前补充结果整理步骤`);
    return;
  }
  if (issue.code === "dead_end" && node && end && node.id !== end.id) {
    node.next = end.id;
    applied.push(`把「${node.title}」接回完成节点`);
    return;
  }
  if (issue.code === "unreachable" && node && node.type !== "trigger" && node.type !== "end") {
    delete nodes[node.id];
    delete draft.ui.positions[node.id];
    applied.push(`移除无法到达的步骤「${node.title}」`);
    return;
  }
  if (
    issue.code === "meta_node_detected"
    && node
    && node.type !== "trigger"
    && node.type !== "end"
    && node.ui?.visibility !== "control"
    && node.controlPlane?.hiddenByDefault !== true
  ) {
    const target = node.next ?? end?.id ?? null;
    redirectReferences(nodes, node.id, target);
    delete nodes[node.id];
    delete draft.ui.positions[node.id];
    applied.push(`移除误识别的目标声明「${node.title}」`);
    return;
  }
  if (issue.code === "tool_recovery" && node?.tool) {
    node.tool = { ...node.tool, maxRetries: 3 };
    applied.push(`为「${node.title}」设置三次尝试`);
    return;
  }
  if (issue.code === "condition_empty" && node?.type === "condition" && node.condition) {
    const target = node.next ?? end?.id ?? null;
    node.condition = { ...node.condition, source: node.condition.source ?? "input.input", operator: "truthy", branches: [{ label: "满足", value: true, next: target }], defaultNext: end?.id ?? null };
    applied.push(`为「${node.title}」补充判断分支`);
    return;
  }
  if (issue.code === "condition_default" && node?.condition) {
    node.condition = { ...node.condition, defaultNext: node.next ?? end?.id ?? null };
    applied.push(`为「${node.title}」补充其他情况路径`);
    return;
  }
  if (issue.code === "failure_target" && node) {
    node.onErrorNext = end?.id ?? null;
    applied.push(`修复「${node.title}」的备用路径`);
    return;
  }
  if (issue.code === "loop_limit" && node?.loop) {
    node.loop = { ...node.loop, maxIterations: 5 };
    applied.push(`把「${node.title}」的处理上限设为五项`);
    return;
  }
  if (issue.code === "wait_event_key" && node?.wait) {
    node.wait = { ...node.wait, eventKey: `event_${node.id}` };
    applied.push(`为「${node.title}」补充消息标识`);
    return;
  }
  if (issue.code === "wait_timeout_route" && node?.wait && end) {
    node.wait = { ...node.wait, onTimeoutNext: end.id };
    applied.push(`把「${node.title}」超时后接到安全结束`);
    return;
  }
  if (issue.code === "agent_call_recovery" && node && end) {
    node.onErrorNext = end.id;
    applied.push(`为「${node.title}」补充不可用时的安全结束路径`);
    return;
  }
  if (issue.code === "handoff_deliverables" && node) {
    node.contract = { ...node.contract, deliverables: [`${node.title}处理结果`], mustNotInclude: node.contract?.mustNotInclude ?? [], inputSchema: node.contract?.inputSchema ?? [], outputSchema: node.contract?.outputSchema ?? [] };
    applied.push(`为「${node.title}」补充必交内容`);
    return;
  }
  if (issue.code === "handoff_prohibited" && node) {
    node.contract = { ...node.contract, deliverables: node.contract?.deliverables ?? [], mustNotInclude: ["密钥和访问令牌", "个人隐私", "内部草稿"], inputSchema: node.contract?.inputSchema ?? [], outputSchema: node.contract?.outputSchema ?? [] };
    applied.push(`为「${node.title}」补充禁止传递边界`);
    return;
  }
  if (issue.code === "handoff_input_schema" && node) {
    node.contract = { ...node.contract, deliverables: node.contract?.deliverables ?? [], mustNotInclude: node.contract?.mustNotInclude ?? [], inputSchema: [{ name: "brief", label: "任务说明", type: "string", required: true }], outputSchema: node.contract?.outputSchema ?? [] };
    applied.push(`为「${node.title}」补充输入字段`);
    return;
  }
  if (issue.code === "handoff_output_schema" && node) {
    node.contract = { ...node.contract, deliverables: node.contract?.deliverables ?? [], mustNotInclude: node.contract?.mustNotInclude ?? [], inputSchema: node.contract?.inputSchema ?? [], outputSchema: [{ name: "result", label: "处理结果", type: "any", required: true }] };
    applied.push(`为「${node.title}」补充输出字段`);
    return;
  }
  if (issue.code === "handoff_memory" && node?.contract) {
    node.contract = { ...node.contract, memoryPolicy: { mode: "none", shared: [], private: ["密钥", "个人隐私", "内部草稿"] } };
    applied.push(`为「${node.title}」补充经验边界`);
    return;
  }
  skipped.push(issue.title);
}

export function applySafeAuditFixes(input: WorkflowDraft, options: { codes?: ReadonlySet<string> } = {}): SafeAuditFixResult {
  const draft = structuredClone(input);
  const applied: string[] = [];
  const skipped: string[] = [];
  const processed = new Set<string>();
  for (let pass = 0; pass < 3; pass += 1) {
    const issues = auditWorkflow(draft).issues.filter((item) =>
      item.fixable
      && (!options.codes || options.codes.has(item.code))
      && !processed.has(`${item.code}:${item.nodeId ?? "workflow"}`));
    if (issues.length === 0) break;
    for (const issue of issues) {
      processed.add(`${issue.code}:${issue.nodeId ?? "workflow"}`);
      safeFixIssue(draft, issue, applied, skipped);
    }
  }
  const parsed = WorkflowDraft.parse(draft);
  const after = auditWorkflow(parsed);
  return {
    draft: parsed,
    applied: [...new Set(applied)],
    skipped: [...new Set(skipped)],
    remainingCritical: after.counts.critical,
    remainingWarnings: after.counts.warning,
  };
}
