import {
  PublicToolCallInput, PublicToolCallReference, PublicToolCallResult, PublicToolListResult,
  PublicToolManageInput, PublicToolManageResult, PublicToolReadResult, PublicToolReference,
} from "@/contracts/public-agent-tool";
import { PublicToolKeyManagementResult } from "@/contracts/public-tool-key-management";

export function validManagementCredential(value: string) {
  return /^[A-Za-z0-9._~-]{32,256}$/.test(value) && !value.startsWith("pat_");
}
export function validCallCredential(value: string) { return /^pat_[a-f0-9]{64}$/.test(value); }
export function newPublicToolRequestId() {
  try { return PublicToolCallInput.shape.requestId.parse(crypto.randomUUID()); }
  catch { return null; }
}
function managementCredential(value: string) {
  if (!validManagementCredential(value)) throw new Error("请填写管理凭据，不使用工具调用凭据管理工具");
  return value;
}
function callCredential(value: string) {
  if (!validCallCredential(value)) throw new Error("请填写有效格式的工具调用凭据，不使用管理凭据调用工具");
  return value;
}

export async function readManagedTools(credential: string) {
  const token = managementCredential(credential);
  const { listPublicToolsAction } = await import("@/server/actions/public-agent-tools");
  const result = PublicToolListResult.parse(await listPublicToolsAction(token));
  if (result.ok && new Set(result.tools.map((tool) => tool.toolId)).size !== result.tools.length) throw new Error("工具清单无法逐项核对");
  return result;
}
export async function changeManagedTool(credential: string, raw: PublicToolManageInput) {
  const token = managementCredential(credential), input = PublicToolManageInput.parse(raw);
  const { managePublicToolAction } = await import("@/server/actions/public-agent-tools");
  const result = PublicToolManageResult.parse(await managePublicToolAction(token, input));
  if (result.ok) {
    const expected = input.operation === "create" ? 1 : input.expectedRevision + 1;
    if (result.recordedRevision !== expected || result.tool.revision < result.recordedRevision
      || input.operation !== "create" && result.tool.toolId !== input.toolId
      || input.operation === "create" && (result.tool.name !== input.name || result.tool.description !== input.description)
      || result.tool.revision === result.recordedRevision && input.operation === "publish"
        && (result.tool.status !== "enabled" || result.tool.publication?.agentId !== input.agentId || result.tool.publication?.versionId !== input.versionId)
      || result.tool.revision === result.recordedRevision && input.operation === "disable" && result.tool.status !== "disabled"
      || result.token && input.operation !== "mint-key"
      || input.operation === "mint-key" && (!result.key || result.key.name !== input.name
        || (result.key.expiresAt === null || input.expiresAt === null ? result.key.expiresAt !== input.expiresAt : Date.parse(result.key.expiresAt) !== Date.parse(input.expiresAt)))
      || input.operation === "revoke-key" && (!result.key || result.key.keyId !== input.keyId || !result.key.revokedAt)) throw new Error("管理回执与原请求无法核对");
  }
  return result;
}
export async function readManagedToolKeys(credential: string, toolId: string) {
  const token = managementCredential(credential), reference = PublicToolReference.parse({ toolId });
  const { readPublicToolKeysAction } = await import("@/server/actions/read-public-tool-keys");
  const result = PublicToolKeyManagementResult.parse(await readPublicToolKeysAction(token, reference));
  if (result.ok && (result.tool.toolId !== reference.toolId || new Set(result.keys.map((key) => key.keyId)).size !== result.keys.length)) throw new Error("凭据清单与所选工具无法核对");
  return result;
}
export async function readCallableTool(credential: string, toolId: string) {
  const token = callCredential(credential), reference = PublicToolReference.parse({ toolId });
  const { readPublicToolAction } = await import("@/server/actions/public-agent-tools");
  const result = PublicToolReadResult.parse(await readPublicToolAction(token, reference));
  if (result.ok && result.tool.toolId !== reference.toolId) throw new Error("调用字段与所选工具无法核对");
  return result;
}
function matchingCall(result: PublicToolCallResult, reference: PublicToolCallReference) {
  if (result.ok && (result.call.toolId !== reference.toolId || result.call.requestId !== reference.requestId)) throw new Error("调用回执与原请求无法核对");
  return result;
}
export async function submitToolCall(credential: string, toolId: string, raw: PublicToolCallInput) {
  const token = callCredential(credential), input = PublicToolCallInput.parse(raw);
  const reference = PublicToolCallReference.parse({ toolId, requestId: input.requestId });
  const { callPublicToolAction } = await import("@/server/actions/public-agent-tools");
  return matchingCall(PublicToolCallResult.parse(await callPublicToolAction(token, reference.toolId, input)), reference);
}
export async function readToolCall(credential: string, raw: PublicToolCallReference) {
  const token = callCredential(credential), reference = PublicToolCallReference.parse(raw);
  const { readPublicToolCallAction } = await import("@/server/actions/public-agent-tools");
  return matchingCall(PublicToolCallResult.parse(await readPublicToolCallAction(token, reference)), reference);
}
