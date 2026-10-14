import {
  ToolOperationGetResult, ToolOperationListInput, ToolOperationListResult,
  ToolOperationReference, ToolOperationResolveInput, ToolOperationResolveResult,
} from "@/contracts/tool-operation";

const readOptions = { cache: "no-store", credentials: "same-origin" } as const;
const uncertain: ToolOperationResolveResult = { ok: false, error: "保存结果暂时无法确认，请先读取最新核对记录。", retryable: true };

export async function readToolOperations(input: ToolOperationListInput, signal?: AbortSignal): Promise<ToolOperationListResult> {
  const filters = ToolOperationListInput.parse(input);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
  const response = await fetch(`/api/tool-operations?${query}`, { ...readOptions, signal });
  const result = ToolOperationListResult.safeParse(await response.json());
  if (!result.success || result.data.ok && !response.ok) throw new Error("核对列表响应无法确认，请重新读取。");
  if (result.data.ok) {
    const { items, nextCursor } = result.data;
    if (items.length > filters.limit || new Set(items.map((item) => item.id)).size !== items.length
      || items.some((item) => filters.status && item.status !== filters.status || filters.sourceRunId && item.sourceRunId !== filters.sourceRunId)
      || nextCursor && (nextCursor.id !== items.at(-1)?.id || nextCursor.id === filters.beforeId && nextCursor.createdAt === filters.before)) {
      throw new Error("核对列表与筛选或翻页信息不一致，请重新读取。");
    }
  }
  return result.data;
}

export async function readToolOperation(operationId: string, signal?: AbortSignal): Promise<ToolOperationGetResult> {
  const reference = ToolOperationReference.parse({ operationId });
  const response = await fetch(`/api/tool-operations/${reference.operationId}`, { ...readOptions, signal });
  const result = ToolOperationGetResult.safeParse(await response.json());
  if (!result.success || result.data.ok && (!response.ok || result.data.operation.id !== operationId)) {
    throw new Error("核对详情响应无法确认，请重新读取。");
  }
  return result.data;
}

export async function submitToolOperationResolution(input: ToolOperationResolveInput): Promise<ToolOperationResolveResult> {
  const parsed = ToolOperationResolveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "核对信息不完整，请检查原因、确认项和实际回执。" };
  try {
    const response = await fetch(`/api/tool-operations/${parsed.data.operationId}`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data),
    });
    const result = ToolOperationResolveResult.safeParse(await response.json());
    if (!result.success || response.status >= 500 || result.data.ok && !response.ok) return uncertain;
    return result.data;
  } catch {
    return uncertain;
  }
}
