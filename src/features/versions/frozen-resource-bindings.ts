import { AgentManifest } from "@/contracts/manifest";
import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES, ToolSpec, WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isCredentialFieldName, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const MAX_PREVIEW_BYTES = 2 * MAX_WORKFLOW_BYTES;
const NodeFields = WorkflowNode.in.shape;
const KnowledgeFields = NodeFields.knowledge.unwrap();
const INLINE_TYPES = new Set(["ai", "tool", "knowledge", "system", "memory", "agent_call", "handoff"]);
const UUID_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

type Binding = { kind: "模型" | "资料" | "工具"; details: string[] };
type StepView = {
  name: string;
  context: string;
  bindings: Binding[];
  warnings: string[];
  ownerNodeId: string | null;
};
type ResourceView = {
  state: "available" | "unknown";
  notice: string;
  model: { selection: string; mock: string; connection: string } | null;
  knowledge: { description: string; items: Array<{ label: string; repeated: number }> } | null;
  tools: string;
  steps: StepView[];
  unknownFieldCount: number | null;
  warnings: string[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function extraCount(value: Record<string, unknown> | null, shape: object): number {
  return value ? Object.keys(value).filter((key) => !Object.hasOwn(shape, key)).length : 0;
}

function counts(values: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function storedId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function unknownView(notice: string): ResourceView {
  return {
    state: "unknown", notice, model: null, knowledge: null,
    tools: "原快照无法完整核对，工具声明范围未知。",
    steps: [], unknownFieldCount: null, warnings: [],
  };
}

// 完整性由原记录读取边界证明；契约解析成功不能证明字段未被预先补齐或删除。
export function frozenResourceBindingsView(
  originalManifest: unknown,
  options: { originalSnapshotComplete: boolean },
): ResourceView {
  if (options.originalSnapshotComplete !== true) {
    return unknownView("尚未确认拿到这个版本的完整原快照，资源声明和绑定范围未知。");
  }
  try {
    if (!isPassiveJsonData(originalManifest, MAX_PREVIEW_BYTES)) {
      return unknownView("原快照不能安全解释，资源声明和绑定范围未知。");
    }
    const raw = object(originalManifest);
    if (!raw || new TextEncoder().encode(JSON.stringify(raw)).byteLength > MAX_PREVIEW_BYTES) {
      return unknownView("原快照超出只读预览范围，资源声明和绑定范围未知。");
    }
    const workflow = object(raw.workflowSnapshot);
    if (!workflow || new TextEncoder().encode(JSON.stringify(workflow)).byteLength > MAX_WORKFLOW_BYTES) {
      return unknownView("原流程超出只读预览范围，资源声明和绑定范围未知。");
    }
    const parsed = AgentManifest.safeParse(raw);
    if (!parsed.success) return unknownView("原快照不符合当前版本契约，资源声明和绑定范围未知。");

    const selection = object(raw.resourceSelection)!;
    const model = object(selection.model)!;
    const nodes = object(workflow.nodes)!;
    const knowledgeSaved = Object.hasOwn(raw, "knowledgeSnapshot");
    const knowledgeIds = knowledgeSaved ? parsed.data.knowledgeSnapshot : [];
    const knowledgeCounts = counts(knowledgeIds);
    const identifiers = new Set<string>();
    const addId = (value: unknown) => { if (typeof value === "string" && value) identifiers.add(value); };
    addId(workflow.id);
    addId(workflow.versionId);
    addId(object(workflow.rootAgent)?.id);
    addId(raw.workflowFingerprint);
    addId(model.modelId);
    addId(model.connectionId);
    for (const id of knowledgeIds) addId(id);
    const collectStepIds = (step: Record<string, unknown>) => {
      addId(step.id);
      addId(object(step.agent)?.id);
      const tool = object(step.tool);
      addId(tool?.registryToolId);
      addId(tool?.connector);
      addId(tool?.action);
      addId(tool?.intentAction);
      addId(tool?.scope);
      addId(tool?.protocol);
      const knowledge = object(step.knowledge);
      if (Array.isArray(knowledge?.sourceIds)) knowledge.sourceIds.forEach(addId);
      addId(object(step.agentCall)?.targetAgentId);
      addId(object(step.agentCall)?.versionId);
      addId(object(step.toAgent)?.id);
      addId(object(step.toAgent)?.versionId);
    };
    for (const [key, value] of Object.entries(nodes)) {
      addId(key);
      const step = object(value)!;
      collectStepIds(step);
      const subflow = object(step.subflow);
      if (Array.isArray(subflow?.steps)) {
        for (const item of subflow.steps) { const inline = object(item); if (inline) collectStepIds(inline); }
      }
      const parallel = object(step.parallel);
      if (Array.isArray(parallel?.branches)) {
        for (const item of parallel.branches) {
          const branch = object(item)!;
          addId(branch.id);
          if (Array.isArray(branch.steps)) {
            for (const entry of branch.steps) { const inline = object(entry); if (inline) collectStepIds(inline); }
          }
        }
      }
    }
    // 额外字段仅参与隐藏已知标识和凭据，不作为资源目录或绑定证据。
    const pending: unknown[] = [raw];
    while (pending.length) {
      const current = pending.pop();
      if (Array.isArray(current)) { pending.push(...current); continue; }
      const fields = object(current);
      if (!fields) continue;
      for (const [key, value] of Object.entries(fields)) {
        if (/^(?:id|.*(?:Id|_id)|.*(?:Ids|_ids))$/i.test(key) || isCredentialFieldName(key)) {
          if (Array.isArray(value)) value.forEach(addId);
          else addId(value);
        }
        if (value !== null && typeof value === "object") pending.push(value);
      }
    }
    const name = (value: unknown, fallback: string): string => {
      if (typeof value !== "string" || !value.trim()) return fallback;
      let safe = redactSensitiveText(value).replace(UUID_TEXT, "[已隐藏标识]");
      for (const id of identifiers) {
        if (id.length >= 4 && id.length <= safe.length) safe = safe.split(id).join("[已隐藏标识]");
      }
      safe = safe.replace(/[A-Za-z0-9_.:@/\\-]+/g, (token) => identifiers.has(token) ? "[已隐藏标识]" : token);
      safe = safe.replace(/\b(?:runId|workspace(?:Id|_id)?|agentId|versionId|registryToolId|connectionId|modelId|sourceIds?)\b/gi, "[已隐藏标识]");
      const chars = Array.from(safe.trim());
      return chars.slice(0, 160).join("") + (chars.length > 160 ? "…" : "");
    };

    let unknownFieldCount = extraCount(raw, AgentManifest.shape)
      + extraCount(selection, AgentManifest.shape.resourceSelection.shape)
      + extraCount(model, AgentManifest.shape.resourceSelection.shape.model.shape)
      + extraCount(workflow, WorkflowDraft.shape);
    const steps: StepView[] = [];
    const warnings: string[] = [];
    const topTitles = counts(Object.values(nodes).map((node) => String(object(node)!.title)));
    const append = (
      step: Record<string, unknown>,
      context: string,
      ownerNodeId: string,
      identifiable: boolean,
      inline: boolean,
      identityWarnings: string[] = [],
    ) => {
      const valid = WorkflowNode.safeParse(step).success;
      const rowWarnings = [...identityWarnings];
      const title = typeof step.title === "string" ? step.title : "";
      if (!title.trim()) rowWarnings.push("原步骤未保存可显示的名称；列表序号不是历史名称。");
      if (!valid) rowWarnings.push("原步骤不能按当前步骤契约完整解释，未补齐缺失字段。");
      if (inline && !INLINE_TYPES.has(String(step.type))) {
        rowWarnings.push("内嵌步骤类型不在当前支持范围内，未继续展开嵌套配置。");
      }
      unknownFieldCount += extraCount(step, NodeFields);
      unknownFieldCount += extraCount(object(step.contract), NodeFields.contract.unwrap().shape);
      const bindings: Binding[] = [];
      const modelConsumer = step.type === "ai"
        || step.type === "rule" && object(step.rule)?.kind === "business_rule" && !Object.hasOwn(step, "quality");
      if (modelConsumer || Object.hasOwn(step, "modelClass")) {
        bindings.push({
          kind: "模型",
          details: [
            modelConsumer ? "此类步骤使用版本的模型选择声明；未保存独立的步骤模型选择。"
              : "原步骤存在模型能力分类字段；不能据此判断是否调用模型。",
            typeof model.modelId === "string" && model.modelId.trim()
              ? "版本保存了模型选择标识，历史模型名称和连接配置未保存。"
              : "版本的模型选择标识为空，无法确认所选模型。",
          ],
        });
      }
      if (step.type === "tool" || Object.hasOwn(step, "tool")) {
        const tool = object(step.tool);
        unknownFieldCount += extraCount(tool, ToolSpec.shape);
        const checked = ToolSpec.safeParse(step.tool);
        const details: string[] = [];
        if (!Object.hasOwn(step, "tool")) details.push("原步骤未保存工具声明。");
        else if (!checked.success || !tool) details.push("原工具声明不能按当前契约解释，未补齐字段。");
        else {
          if (!Object.hasOwn(tool, "registryToolId")) details.push("工具引用原字段未保存；契约默认未指定目录工具。");
          else if (tool.registryToolId === null) details.push("工具引用原字段明确未指定目录工具。");
          else if (typeof tool.registryToolId === "string" && !tool.registryToolId.trim()) details.push("工具引用原字段为空，无法确认目录工具。");
          else details.push("原步骤保存了目录工具引用；版本未保存工具目录快照，无法对应历史工具名称和定义。");
          details.push("连接、动作和权限范围声明已保存；不证明历史权限或当前可用性。");
          if ([tool.connector, tool.action, tool.scope, tool.protocol].some((value) => value === "")) {
            details.push("连接、动作、权限范围或通信方式中有原字段为空，声明内容尚不完整。");
          }
          details.push(Object.hasOwn(tool, "risk") ? "风险等级来自原字段。"
            : "风险等级原字段未保存；契约默认按高风险处理。");
          details.push(Object.hasOwn(tool, "maxRetries") ? "重试次数来自原字段。"
            : "重试次数原字段未保存；契约默认最多重试 3 次。");
          details.push(Object.hasOwn(tool, "inputSchema") ? "输入结构声明来自原字段。"
            : "输入结构原字段未保存；契约默认对象结构。");
          details.push(Object.hasOwn(tool, "outputSchema") ? "输出结构声明来自原字段。"
            : "输出结构原字段未保存；契约默认对象结构。");
          if (Object.hasOwn(tool, "unresolved")) {
            details.push(tool.unresolved ? "原声明标记：工具尚待补齐。" : "原声明标记：未标为待补齐；这不是可用性检查。");
          } else details.push("原声明未保存待补齐标记。");
        }
        if (step.type !== "tool") rowWarnings.push("工具配置与步骤类型不一致；只展示已保存声明。");
        bindings.push({ kind: "工具", details });
      }
      if (step.type === "knowledge" || Object.hasOwn(step, "knowledge")) {
        const knowledge = object(step.knowledge);
        unknownFieldCount += extraCount(knowledge, KnowledgeFields.shape);
        const checked = KnowledgeFields.safeParse(step.knowledge);
        const details: string[] = [];
        if (!Object.hasOwn(step, "knowledge")) details.push("原步骤未保存资料声明。");
        else if (!checked.success || !knowledge) details.push("原资料声明不能按当前契约解释，未补齐字段。");
        else {
          details.push("原资料空间名称：" + name(knowledge.space, "未保存可显示的名称") + "；这不是资料文件名称。");
          if (!Object.hasOwn(knowledge, "sourceIds")) details.push("原步骤未保存资料引用列表，绑定范围未知。");
          else if (!checked.data.sourceIds?.length) details.push("原步骤明确保存了 0 项资料引用。");
          else {
            const referenceCounts = counts(checked.data.sourceIds);
            checked.data.sourceIds.forEach((id, index) => {
              const matches = knowledgeCounts.get(id) ?? 0;
              const prefix = "引用第 " + (index + 1) + " 项：";
              if (!knowledgeSaved) details.push(prefix + "版本未保存资料声明列表，无法核对对应关系。");
              else if (matches === 0) details.push(prefix + "未找到该版本中的资料声明。");
              else if (matches > 1) details.push(prefix + "该版本有 " + matches + " 项同标识声明，无法唯一对应。");
              else details.push(prefix + "对应资料声明第 " + (knowledgeIds.indexOf(id) + 1) + " 项；历史资料名称未保存。");
              if ((referenceCounts.get(id) ?? 0) > 1) details.push("此项引用在原步骤中重复，未合并或删除。");
            });
          }
          details.push(Object.hasOwn(knowledge, "selectionRequired")
            ? knowledge.selectionRequired ? "原字段记录：要求选择资料。" : "原字段记录：不要求选择资料。"
            : "原步骤未保存是否要求选择资料。");
        }
        if (step.type !== "knowledge") rowWarnings.push("资料配置与步骤类型不一致；只展示已保存声明。");
        bindings.push({ kind: "资料", details });
      }
      steps.push({
        name: name(title, "未保存可显示的步骤名称"),
        context, bindings, warnings: rowWarnings,
        ownerNodeId: identifiable && valid && (!inline || INLINE_TYPES.has(String(step.type))) ? ownerNodeId : null,
      });
    };

    for (const [ownerId, value] of Object.entries(nodes)) {
      const node = object(value)!;
      const ownerName = name(node.title, "未保存可显示的所属步骤名称");
      const titleWarnings = (topTitles.get(String(node.title)) ?? 0) > 1
        ? ["顶层步骤名称重复；归属按原标识核对，不按名称选择第一项。"] : [];
      append(node, "顶层步骤", ownerId, node.id === ownerId, false, titleWarnings);
      const subflow = object(node.subflow);
      unknownFieldCount += extraCount(subflow, NodeFields.subflow.unwrap().shape);
      if (Array.isArray(subflow?.steps)) {
        const entries = subflow.steps.map((entry) => object(entry)!);
        const idCounts = counts(entries.map((entry) => storedId(entry.id)).filter((id): id is string => id !== null));
        const titleCounts = counts(entries.map((entry) => String(entry.title ?? "")));
        for (const entry of entries) {
          const id = storedId(entry.id);
          const issues: string[] = [];
          if (!id) issues.push("原内嵌步骤未保存可核对的标识；不使用运行层生成的标识定位。");
          else if ((idCounts.get(id) ?? 0) > 1) issues.push("原内嵌步骤标识重复，不能唯一核对归属。");
          if ((titleCounts.get(String(entry.title ?? "")) ?? 0) > 1) issues.push("内嵌步骤名称重复，不按名称合并或选择第一项。");
          if (node.type !== "subflow") issues.push("一组步骤配置与所属步骤类型不一致。");
          append(entry, "所属步骤：" + ownerName + " · 一组步骤：" + name(subflow.name, "未保存可显示的名称"),
            ownerId, node.type === "subflow" && id !== null && idCounts.get(id) === 1, true, issues);
        }
      }
      const parallel = object(node.parallel);
      unknownFieldCount += extraCount(parallel, NodeFields.parallel.unwrap().shape);
      if (Array.isArray(parallel?.branches)) {
        const branches = parallel.branches.map((entry) => object(entry)!);
        const branchCounts = counts(branches.map((branch) => String(branch.id)));
        const branchTitles = counts(branches.map((branch) => String(branch.label)));
        const runtimeIds: string[] = [];
        for (const branch of branches) {
          for (const entry of branch.steps as Array<Record<string, unknown>>) {
            const id = storedId(entry.id);
            if (id) runtimeIds.push(String(branch.id) + "." + id);
          }
        }
        const runtimeCounts = counts(runtimeIds);
        for (const branch of branches) {
          unknownFieldCount += extraCount(branch, NodeFields.parallel.unwrap().shape.branches.element.shape);
          const entries = branch.steps as Array<Record<string, unknown>>;
          const idCounts = counts(entries.map((entry) => storedId(entry.id)).filter((id): id is string => id !== null));
          const titleCounts = counts(entries.map((entry) => String(entry.title ?? "")));
          for (const entry of entries) {
            const id = storedId(entry.id);
            const branchUnique = branchCounts.get(String(branch.id)) === 1;
            const unique = id !== null && idCounts.get(id) === 1 && runtimeCounts.get(String(branch.id) + "." + id) === 1;
            const issues: string[] = [];
            if (!branchUnique) issues.push("原并行工作标识重复，不能唯一核对归属。");
            if ((branchTitles.get(String(branch.label)) ?? 0) > 1) issues.push("并行工作名称重复，不按名称合并或选择第一项。");
            if (!id) issues.push("原内嵌步骤未保存可核对的标识；不使用运行层生成的标识定位。");
            else if (!unique) issues.push("原内嵌步骤标识重复或存在组合冲突，不能唯一核对归属。");
            if ((titleCounts.get(String(entry.title ?? "")) ?? 0) > 1) issues.push("内嵌步骤名称重复，不按名称合并或选择第一项。");
            if (node.type !== "parallel") issues.push("并行配置与所属步骤类型不一致。");
            append(entry, "所属步骤：" + ownerName + " · 并行工作：" + name(branch.label, "未保存可显示的名称"),
              ownerId, node.type === "parallel" && branchUnique && unique, true, issues);
          }
        }
      }
    }
    if (unknownFieldCount) warnings.push("资源核对范围内有 " + unknownFieldCount + " 项额外字段，未用于补齐声明，也未修改原记录。");
    if (steps.some((step) => step.ownerNodeId === null)) warnings.push("部分步骤无法唯一确认或完整解释，未提供定位按钮；不表示整个版本没有步骤。");
    return {
      state: "available",
      notice: "仅核对这个版本原快照中的声明和引用；未检查历史权限、连接配置、资源内容或当前可用性。",
      model: {
        selection: typeof model.modelId === "string" && model.modelId.trim()
          ? "原快照保存了模型选择标识；历史模型名称未保存。" : "原快照的模型选择标识为空，所选模型未知。",
        mock: Object.hasOwn(model, "mock")
          ? model.mock ? "原字段记录：启用模拟模式。" : "原字段记录：未启用模拟模式。"
          : "模拟模式原字段未保存；契约默认未启用模拟模式。",
        connection: Object.hasOwn(model, "connectionId")
          ? model.connectionId === null ? "连接原字段明确未指定已保存连接。" : "连接原字段保存了引用；历史连接名称和配置未保存。"
          : "连接原字段未保存；契约默认未指定已保存连接。",
      },
      knowledge: {
        description: knowledgeSaved
          ? "原快照明确保存了 " + knowledgeIds.length + " 项资料声明；历史资料名称和内容未保存。"
          : "原快照未保存资料声明列表；契约默认空列表，不能当作历史明确选择了 0 项。",
        items: knowledgeIds.map((id, index) => ({ label: "资料声明第 " + (index + 1) + " 项（历史名称未保存）", repeated: knowledgeCounts.get(id)! })),
      },
      tools: "当前版本契约未保存工具目录快照，无法核对历史工具名称、定义和权限；仅展示步骤中保存的引用声明。",
      steps, unknownFieldCount, warnings,
    };
  } catch {
    return unknownView("原快照暂时不能安全核对，资源声明和绑定范围未知。");
  }
}

export type FrozenResourceBindingsView = ReturnType<typeof frozenResourceBindingsView>;
