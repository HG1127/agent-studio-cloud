import { isPassiveJsonData } from "@/contracts/json";
import { MAX_RUN_RESULT_BYTES, RunSourceType, RunStatus, type RunStepView, type RunView } from "@/contracts/run";
import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { presentBusinessOutput } from "./present-business-output";
import { savedRunResultView } from "./run-result-view";
import { runValueLabel } from "./StructuredRunValue";

type ExportRun = Pick<RunView, "id" | "agentId" | "versionId" | "parentRunId" | "status" | "sourceType" | "result" | "outputContract">;

const STATUS_LABELS = {
  queued: "等待执行", running: "运行中", waiting_approval: "等待人工确认",
  waiting_event: "等待补充信息", completed: "运行已完成", failed: "运行失败", cancelled: "运行已取消",
} satisfies Record<RunView["status"], string>;
const SOURCE_LABELS = {
  manual: "手动发起", schedule: "定时任务发起", agent_call: "其他助手调用", handoff: "其他助手交接", evaluation: "自动验收发起",
} satisfies Record<RunView["sourceType"], string>;
const UNKNOWN_CONTENT = "已保存结果暂时不能安全解释，整份导出已停用；请在结果与执行证据中核对。";
const UNKNOWN_REFERENCE = "已保存内容含有无法核对的内部关联，整份导出已停用；请先核对执行证据。";
const UNKNOWN_BODY = "部分已保存内容没有可核对的业务正文，整份导出已停用；不会把提示文字或部分内容当作完整成果。";
const EXPORT_SCOPE = "仅包含本页已读到的业务展示内容；常见敏感信息和已核对的内部关联已隐藏，不含运行输入、过程证据或开发者数据。这是当前页面快照，不会重新读取服务器，也不是完整的数据安全审查。";
const UUID_IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UnavailableExport extends Error {}

function sameIdentity(left: string, right: string) {
  return UUID_IDENTITY.test(left) && UUID_IDENTITY.test(right) ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function knownReference(value: string, expected: ReadonlySet<string>, knownUUIDs: ReadonlySet<string>) {
  if (expected.has(value)) return true;
  if (!UUID_IDENTITY.test(value) || !knownUUIDs.has(value.toLowerCase())) return false;
  return [...expected].some((identity) => UUID_IDENTITY.test(identity) && sameIdentity(value, identity));
}

function conditionRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "matched") || !Object.hasOwn(record, "next")) return null;
  if (typeof record.matched !== "string" || record.next !== null && typeof record.next !== "string") return null;
  return { matched: record.matched, next: record.next };
}

function references(run: ExportRun, steps: readonly RunStepView[]) {
  const unique = (values: readonly (string | null | undefined)[]) => new Set(values.filter((value): value is string => Boolean(value)));
  const nodeIds = unique([...steps.map((step) => step.nodeId), ...run.outputContract.fields.map((field) => field.sourceNodeId)]);
  const identityIds = unique([run.id, run.agentId, run.versionId, run.parentRunId, ...steps.map((step) => step.id)]);
  const allIds = new Set([...identityIds, ...nodeIds]);
  const knownUUIDs = new Set([...allIds].filter((identity) => UUID_IDENTITY.test(identity)).map((identity) => identity.toLowerCase()));
  const keys: Record<string, ReadonlySet<string>> = {
    runid: unique([run.id]), agentid: unique([run.agentId]), versionid: unique([run.versionId]),
    parentrunid: unique([run.parentRunId]), stepid: unique(steps.map((step) => step.id)),
    nodeid: nodeIds, sourcenodeid: nodeIds, targetnodeid: nodeIds, targetid: allIds,
    targetagentid: unique([run.agentId]), fieldid: unique(run.outputContract.fields.map((field) => field.path)),
    fieldpath: unique(run.outputContract.fields.map((field) => field.path)),
    sourcerunid: unique([run.id]), sourceid: allIds, targetversionid: unique([run.versionId]),
    nodeids: nodeIds, fieldids: unique(run.outputContract.fields.map((field) => field.path)),
    childrunid: new Set(), workflowrunid: new Set(), workflowid: new Set(), workspaceid: new Set(),
    createdby: new Set(), connectionid: new Set(), eventkey: new Set(),
  };
  return { keys, identityIds, knownUUIDs };
}

function safeText(value: string, knownUUIDs: ReadonlySet<string>) {
  const safe = redactSensitiveText(value);
  if ([...knownUUIDs].some((identity) => safe.toLowerCase().includes(identity))) throw new UnavailableExport(UNKNOWN_REFERENCE);
  return safe;
}

function businessText(value: string, knownUUIDs: ReadonlySet<string>) {
  if (!value.trim()) return JSON.stringify(value);
  const presented = presentBusinessOutput(value);
  if (!presented.reviewable) throw new UnavailableExport(UNKNOWN_BODY);
  return safeText(presented.text, knownUUIDs);
}

function displayText(value: unknown, context: ReturnType<typeof references>, depth = 0): string {
  if (depth > 12) throw new UnavailableExport(UNKNOWN_CONTENT);
  if (value === null) return "空值（已保存）";
  if (typeof value === "string") return businessText(value, context.knownUUIDs);
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return "空列表（已保存）";
    return value.map((item, index) => String(index + 1) + ". " + displayText(item, context, depth + 1).replace(/\n/g, "\n   ")).join("\n");
  }
  if (!value || typeof value !== "object") throw new UnavailableExport(UNKNOWN_CONTENT);
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return "空对象（已保存）";
  const visible: string[] = [];
  for (const [key, item] of entries) {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    const expected = Object.hasOwn(context.keys, normalized) ? context.keys[normalized] : undefined;
    if (expected) {
      if (typeof item === "string" && knownReference(item, expected, context.knownUUIDs)) continue;
      if (Array.isArray(item) && item.length > 0 && item.every((part) => typeof part === "string" && knownReference(part, expected, context.knownUUIDs))) continue;
      throw new UnavailableExport(UNKNOWN_REFERENCE);
    }
    if (normalized === "id" && typeof item === "string" && knownReference(item, context.identityIds, context.knownUUIDs)) continue;
    const label = safeText(runValueLabel(key, visible.length), context.knownUUIDs);
    visible.push(label + "：" + displayText(item, context, depth + 1).replace(/\n/g, "\n  "));
  }
  if (!visible.length) throw new UnavailableExport(UNKNOWN_CONTENT);
  return visible.join("\n");
}

function outputText(
  run: ExportRun,
  output: ReturnType<typeof savedRunResultView>["outputs"][number],
  steps: readonly RunStepView[],
  context: ReturnType<typeof references>,
  stepsUnavailable: boolean,
) {
  const definition = run.outputContract.fields.find((field) => field.path === output.key);
  const legacyPath = definition?.path.replace(/^(?:context\.)?outputs\./, "").split(".");
  const sourceId = definition ? definition.sourceNodeId ?? legacyPath?.[0] : output.key;
  const sourcePath = definition ? definition.sourceNodeId ? definition.sourcePath ?? [] : legacyPath?.slice(1) ?? [] : [];
  const source = sourceId ? steps.find((step) => sameIdentity(step.nodeId, sourceId)) : undefined;
  const destinationText = (next: string) => {
    const target = steps.find((step) => sameIdentity(step.nodeId, next));
    const title = target?.nodeTitle?.trim();
    if (!target || !title || title === target.nodeId) throw new UnavailableExport(UNKNOWN_REFERENCE);
    return safeText(title, context.knownUUIDs);
  };
  if (sourcePath.length) {
    if (sourcePath.length !== 1 || sourcePath[0] !== "next") return displayText(output.output, context);
    if (!source || stepsUnavailable) throw new UnavailableExport(UNKNOWN_REFERENCE);
    if (source.nodeType !== "condition") return displayText(output.output, context);
    if (!isPassiveJsonData(source.output, MAX_RUN_RESULT_BYTES)) throw new UnavailableExport(UNKNOWN_REFERENCE);
    const recorded = conditionRecord(redactSensitiveData(source.output));
    if (!recorded || typeof recorded.next !== "string" || typeof output.output !== "string" || !sameIdentity(recorded.next, output.output)) {
      throw new UnavailableExport(UNKNOWN_REFERENCE);
    }
    return "记录的去向：" + destinationText(recorded.next) + "\n只反映本次保存的去向，不代表目标步骤已执行、流程已完成或验收通过。";
  }
  const delivered = conditionRecord(output.output);
  if (!source || stepsUnavailable) {
    if ((definition?.sourceNodeId || !definition) && sourceId && delivered) throw new UnavailableExport(UNKNOWN_REFERENCE);
    return displayText(output.output, context);
  }
  if (source.nodeType !== "condition") return displayText(output.output, context);
  if (!isPassiveJsonData(source.output, MAX_RUN_RESULT_BYTES)) throw new UnavailableExport(UNKNOWN_REFERENCE);
  const recorded = conditionRecord(source.output);
  const safeRecord = conditionRecord(redactSensitiveData(source.output));
  const sameDestination = safeRecord && delivered && (safeRecord.next === null ? delivered.next === null : delivered.next !== null && sameIdentity(safeRecord.next, delivered.next));
  if (!recorded || !safeRecord || !delivered || !sameDestination || safeRecord.matched !== delivered.matched) {
    throw new UnavailableExport(UNKNOWN_REFERENCE);
  }
  let destination = "条件记录没有指定后续步骤，不据此判断流程已结束。";
  if (recorded.next !== null) destination = destinationText(recorded.next);
  const remaining = Object.fromEntries(Object.entries(output.output as Record<string, unknown>).filter(([key]) => key !== "matched" && key !== "next"));
  return "命中的分支：" + businessText(delivered.matched, context.knownUUIDs)
    + "\n记录的去向：" + destination
    + "\n只反映本次保存的判断和去向，不代表后续步骤已完成或验收通过。"
    + (Object.keys(remaining).length ? "\n" + displayText(remaining, context) : "");
}

function markdownHeading(value: string) {
  return value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").replace(/([\\`*_{}\[\]()<>#!|])/g, "\\$1");
}

function textFence(value: string) {
  const marker = String.fromCharCode(96);
  const longest = (value.match(/`+/g) ?? []).reduce((maximum, match) => Math.max(maximum, match.length), 0);
  const fence = marker.repeat(Math.max(3, longest + 1));
  return fence + "text\n" + value + "\n" + fence;
}

function csvCell(value: string) {
  const trimmed = value.replace(/^[\s\u0000-\u001f\u007f]+/u, "");
  const neutralized = /^[=+@-]/.test(trimmed) || /^[\u0000-\u001f\u007f]/.test(value) ? "'" + value : value;
  return '"' + neutralized.replace(/"/g, '""') + '"';
}

export function savedBusinessResultExport(run: ExportRun, steps: readonly RunStepView[] = [], stepsUnavailable = false) {
  try {
    const status = RunStatus.safeParse(run.status);
    const source = RunSourceType.safeParse(run.sourceType);
    if (!status.success || !source.success) return { available: false as const, message: "运行状态或发起方式暂时无法核对，整份导出已停用。" };
    if (run.result === null || run.result === undefined) return { available: false as const, message: "当前没有可导出的已保存结果。" };
    if (!isPassiveJsonData(run.result, MAX_RUN_RESULT_BYTES, 12) || !isPassiveJsonData(run.outputContract, MAX_RUN_RESULT_BYTES)) {
      throw new UnavailableExport(UNKNOWN_CONTENT);
    }
    const ownSteps = stepsUnavailable ? [] : steps.filter((step) => sameIdentity(step.runId, run.id));
    const titles = new Map(ownSteps.map((step) => [step.nodeId, step.nodeTitle?.trim() && step.nodeTitle.trim() !== step.nodeId ? step.nodeTitle.trim() : null]));
    const result = savedRunResultView(run, titles);
    if (!result.outputs.length) return { available: false as const, message: "当前没有可导出的业务展示内容。" };
    const context = references(run, ownSteps);
    const rows = result.outputs.map((output, index) => ({
      label: safeText(output.label.trim() || "交付内容 " + String(index + 1), context.knownUUIDs),
      text: outputText(run, output, ownSteps, context, stepsUnavailable),
    }));
    const stateText = STATUS_LABELS[status.data] + "；" + SOURCE_LABELS[source.data] + "；完成状态不等于通过验收"
      + (source.data === "evaluation" ? "；本文件不判定验收结论，不代表安全模拟或外部业务未执行" : "");
    const markdown = "# 已保存业务成果\n\n记录状态：" + stateText + "\n\n" + EXPORT_SCOPE + "\n\n"
      + rows.map((row) => "## " + markdownHeading(row.label) + "\n\n" + textFence(row.text)).join("\n\n") + "\n";
    const csv = "\uFEFF" + [["记录状态", "交付内容", "已保存内容"], ...rows.map((row) => [stateText, row.label, row.text])]
      .map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    if (new TextEncoder().encode(markdown).byteLength > MAX_RUN_RESULT_BYTES || new TextEncoder().encode(csv).byteLength > MAX_RUN_RESULT_BYTES) {
      throw new UnavailableExport("导出内容超过本地可安全处理的范围，整份导出已停用。");
    }
    return { available: true as const, markdown, csv, stateText, scopeText: EXPORT_SCOPE };
  } catch (error) {
    return { available: false as const, message: error instanceof UnavailableExport ? error.message : UNKNOWN_CONTENT };
  }
}
