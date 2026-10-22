"use server";

import {
  PublicToolCallInput, PublicToolCallReference, PublicToolCallResult, PublicToolFailure, PublicToolListResult,
  PublicToolManageInput, PublicToolManageResult, PublicToolReadResult, PublicToolReference,
} from "@/contracts/public-agent-tool";
import { StartRunResult } from "@/contracts/run";
import { publicToolAdminAuthorized } from "@/server/security/public-agent-tool";
import { publicToolSourceKey } from "@/server/domain/public-agent-tool";
import { authorizePublicTool, getPublicTool, getPublicToolCallReceipt, getPublicToolStoredCall, listPublicTools } from "@/server/queries/public-agent-tools";
import { admitPublicToolCall, bindPublicToolRun, managePublicTool, PublicToolRejected } from "@/server/services/public-agent-tools";
import { startRunCore } from "@/server/services/start-run-core";

function failure(error: unknown): PublicToolFailure {
  return error instanceof PublicToolRejected ? { ok: false, code: error.code, error: error.message }
    : { ok: false, code: "unavailable", error: "操作结果暂时无法确认，请沿用同一次请求重试", retryable: true };
}
const unauthorized: PublicToolFailure = { ok: false, code: "unauthorized", error: "工具凭据无效或入口未配置" };
export async function managePublicToolAction(token: string, raw: PublicToolManageInput): Promise<PublicToolManageResult> {
  if (!publicToolAdminAuthorized(token)) return unauthorized;
  const input = PublicToolManageInput.safeParse(raw);
  if (!input.success) return { ok: false, code: "invalid", error: "工具管理参数不正确或尚未确认" };
  try { return PublicToolManageResult.parse(await managePublicTool(input.data)); } catch (error) { return failure(error); }
}
export async function listPublicToolsAction(token: string): Promise<PublicToolListResult> {
  if (!publicToolAdminAuthorized(token)) return unauthorized;
  try { return PublicToolListResult.parse({ ok: true, ...await listPublicTools() }); } catch (error) { return failure(error); }
}
export async function readPublicToolAction(token: string, raw: PublicToolReference): Promise<PublicToolReadResult> {
  const reference = PublicToolReference.safeParse(raw);
  if (!reference.success) return { ok: false, code: "invalid", error: "工具标识不正确" };
  try {
    if (!await authorizePublicTool(token, reference.data.toolId)) return unauthorized;
    const tool = await getPublicTool(reference.data.toolId);
    return tool ? PublicToolReadResult.parse({ ok: true, tool }) : { ok: false, code: "not_found", error: "找不到这个工具" };
  } catch (error) { return failure(error); }
}
export async function callPublicToolAction(token: string, toolId: string, raw: PublicToolCallInput): Promise<PublicToolCallResult> {
  const reference = PublicToolReference.safeParse({ toolId }), input = PublicToolCallInput.safeParse(raw);
  if (!reference.success || !input.success) return { ok: false, code: "invalid", error: "工具调用参数不正确" };
  try {
    const call = await admitPublicToolCall(token, reference.data.toolId, input.data);
    if (call.runId) return PublicToolCallResult.parse({ ok: true, call: await getPublicToolCallReceipt(call) });
    const started = StartRunResult.parse(await startRunCore({ agentId: call.publication.agentId,
      versionId: call.publication.versionId, input: input.data.input, sourceType: "manual",
      sourceKey: publicToolSourceKey(call.toolId, call.requestId),
    }));
    if (!started.ok) return { ok: false, code: started.resourceLimit ? "resource_limit" : started.retryable ? "unavailable" : "conflict",
      error: started.resourceLimit ? "执行资源额度暂不可用，请沿用同一次请求重试" : "任务未能确认启动，请沿用同一次请求核对",
      ...(started.retryable ? { retryable: true } : {}),
    };
    await bindPublicToolRun(call, started.runId);
    return PublicToolCallResult.parse({ ok: true, call: await getPublicToolCallReceipt({ ...call, runId: started.runId }) });
  } catch (error) { return failure(error); }
}
export async function readPublicToolCallAction(token: string, raw: PublicToolCallReference): Promise<PublicToolCallResult> {
  const input = PublicToolCallReference.safeParse(raw);
  if (!input.success) return { ok: false, code: "invalid", error: "工具调用标识不正确" };
  try {
    if (!await authorizePublicTool(token, input.data.toolId)) return unauthorized;
    const call = await getPublicToolStoredCall(input.data.toolId, input.data.requestId);
    return call ? PublicToolCallResult.parse({ ok: true, call: await getPublicToolCallReceipt(call) })
      : { ok: false, code: "not_found", error: "找不到这次工具调用" };
  } catch (error) { return failure(error); }
}
