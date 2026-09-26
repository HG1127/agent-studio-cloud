import { MAX_WAIT_DURATION_MS, type WorkflowNode } from "@/contracts/workflow";
import { validateJsonSchemaDefinition } from "@/server/domain/json-schema";

export function validateWaitContracts(nodes: Record<string, WorkflowNode>): string | null {
  for (const node of Object.values(nodes)) {
    if (node.type !== "wait") continue;
    const wait = node.wait;
    if (!wait) return `等待步骤「${node.title}」的设置不完整`;
    if (!Number.isFinite(wait.timeoutMs) || wait.timeoutMs < 0) return `等待步骤「${node.title}」的超时时间不正确`;
    if (wait.timeoutMs > MAX_WAIT_DURATION_MS) return `等待步骤「${node.title}」的超时时间不能超过 30 天`;
    if (wait.mode === "delay") {
      if (!Number.isFinite(wait.durationMs) || wait.durationMs <= 0) return `等待步骤「${node.title}」的等待时长必须大于 0`;
      if (wait.durationMs > MAX_WAIT_DURATION_MS) return `等待步骤「${node.title}」的等待时长不能超过 30 天`;
      continue;
    }
    if (wait.mode === "until") {
      if (!wait.until || Number.isNaN(new Date(wait.until).getTime())) return `等待步骤「${node.title}」的继续时间不正确`;
      continue;
    }
    if (!/^[a-zA-Z0-9._:-]{1,120}$/.test(wait.eventKey)) {
      return `等待步骤「${node.title}」的消息标识只能使用字母、数字、点、下划线、冒号或短横线`;
    }
    const schemaError = validateJsonSchemaDefinition(wait.payloadSchema);
    if (schemaError) return `等待步骤「${node.title}」的${schemaError}`;
    if (wait.payloadSchema.type !== undefined) {
      const types = Array.isArray(wait.payloadSchema.type) ? wait.payloadSchema.type : [wait.payloadSchema.type];
      if (!types.includes("object")) return `等待步骤「${node.title}」的消息契约根类型必须包含 object`;
    }
  }
  return null;
}
