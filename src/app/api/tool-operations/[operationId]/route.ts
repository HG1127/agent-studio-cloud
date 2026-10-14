import {
  MAX_TOOL_OPERATION_RESOLVE_BYTES, ToolOperationGetResult, ToolOperationReference,
  ToolOperationResolveInput, ToolOperationResolveResult,
} from "@/contracts/tool-operation";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { resolveToolOperationAction } from "@/server/actions/resolve-tool-operation";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { getToolOperation } from "@/server/queries/tool-operations";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<ToolOperationReference> };
const noStore = { "cache-control": "no-store" };

export async function GET(request: Request, context: RouteContext) {
  if (hasCrossSiteOrigin(request)) return Response.json({ ok: false, error: "不能从其他站点读取业务核对记录" }, { status: 403, headers: noStore });
  const reference = ToolOperationReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "业务操作信息不正确" }, { status: 400, headers: noStore });
  try {
    const operation = await getToolOperation(DEMO_WORKSPACE_ID, reference.data.operationId);
    const result = ToolOperationGetResult.parse(operation
      ? { ok: true, operation } : { ok: false, error: "业务操作不存在或不可访问" });
    return Response.json(result, { status: operation ? 200 : 404, headers: noStore });
  } catch (error) {
    console.error("读取业务核对记录失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "业务核对记录暂时无法读取" }, { status: 500, headers: noStore });
  }
}

export async function POST(request: Request, context: RouteContext) {
  if (!hasSameOrigin(request)) return Response.json({ ok: false, error: "请从本站提交人工核对" }, { status: 403, headers: noStore });
  const reference = ToolOperationReference.safeParse(await context.params);
  if (!reference.success) return Response.json({ ok: false, error: "业务操作信息不正确" }, { status: 400, headers: noStore });
  const body = await readBoundedRequestText(request, MAX_TOOL_OPERATION_RESOLVE_BYTES);
  if (!body.ok) return Response.json({ ok: false, error: body.reason === "too_large" ? "核对内容超过大小限制" : "核对内容必须是有效 JSON" }, {
    status: body.reason === "too_large" ? 413 : 400, headers: noStore,
  });
  let input: unknown;
  try { input = JSON.parse(body.text); } catch {
    return Response.json({ ok: false, error: "核对内容必须是有效 JSON" }, { status: 400, headers: noStore });
  }
  const parsed = ToolOperationResolveInput.safeParse(input);
  if (!parsed.success || parsed.data.operationId !== reference.data.operationId) {
    return Response.json({ ok: false, error: "核对信息不完整或业务操作不一致" }, { status: 400, headers: noStore });
  }
  try {
    const result = ToolOperationResolveResult.parse(await resolveToolOperationAction(parsed.data));
    return Response.json(result, {
      status: result.ok ? 200 : result.retryable ? 503 : 409,
      headers: { ...noStore, ...(!result.ok && result.retryable ? { "retry-after": "2" } : {}) },
    });
  } catch (error) {
    console.error("提交业务核对失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "核对结果暂时无法确认，请使用同一次请求重试", retryable: true }, {
      status: 503, headers: { ...noStore, "retry-after": "2" },
    });
  }
}
