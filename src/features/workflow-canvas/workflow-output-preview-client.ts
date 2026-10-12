import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import {
  MAX_OUTPUT_PREVIEW_BODY_BYTES,
  MAX_OUTPUT_PREVIEW_RESULT_BYTES,
  MAX_OUTPUT_PREVIEW_SAMPLES_BYTES,
  WorkflowOutputPreviewInput,
  WorkflowOutputPreviewResult,
  type WorkflowOutputPreviewInput as PreviewInput,
  type WorkflowOutputPreviewResult as PreviewResult,
} from "@/contracts/workflow-output-preview";

export class OutputPreviewReadError extends Error {
  constructor(public readonly reason: "capacity" | "unknown" | "forbidden" | "unavailable" | "network" | "cancelled") {
    super(reason);
  }
}

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

export function prepareWorkflowOutputPreview(workflow: WorkflowDraft, sources: readonly WorkflowNode[], values: Readonly<Record<string, string>>):
  | { ok: true; input: PreviewInput; body: string }
  | { ok: false; error: string; sourceIndex?: number } {
  const entries: Array<[string, unknown]> = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const text = Object.hasOwn(values, source.id) ? values[source.id] : "";
    if (!text.trim()) continue;
    if (bytes(text) > MAX_OUTPUT_PREVIEW_SAMPLES_BYTES) return { ok: false, error: "这项参考值超过容量限制，原填写已保留。", sourceIndex };
    try { entries.push([source.id, JSON.parse(text)]); }
    catch { return { ok: false, error: "这项参考值的数据格式不完整，请填写有效的数据，原填写已保留。", sourceIndex }; }
  }
  const outputs = Object.fromEntries(entries);
  if (bytes(JSON.stringify(outputs)) > MAX_OUTPUT_PREVIEW_SAMPLES_BYTES) return { ok: false, error: "参考值合计超过容量限制，原填写已保留。" };
  const parsed = WorkflowOutputPreviewInput.safeParse({ workflow, outputs });
  if (!parsed.success) return { ok: false, error: "流程配置或参考值未通过格式与容量检查，原填写已保留。" };
  const body = JSON.stringify(parsed.data);
  if (bytes(body) > MAX_OUTPUT_PREVIEW_BODY_BYTES) return { ok: false, error: "完整试算请求超过容量限制，原填写已保留。" };
  return { ok: true, input: parsed.data, body };
}

async function readResult(response: Response, signal: AbortSignal): Promise<PreviewResult> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_OUTPUT_PREVIEW_RESULT_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new OutputPreviewReadError("capacity");
  }
  if (!response.body) throw new OutputPreviewReadError("unknown");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new OutputPreviewReadError("cancelled");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_OUTPUT_PREVIEW_RESULT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OutputPreviewReadError("capacity");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (signal.aborted) throw new OutputPreviewReadError("cancelled");
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    const parsed = WorkflowOutputPreviewResult.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch { /* 未知响应只显示固定提示，不把返回正文或内部异常带入界面。 */ }
  throw new OutputPreviewReadError("unknown");
}

export async function requestWorkflowOutputPreview(body: string, signal: AbortSignal): Promise<PreviewResult> {
  try {
    if (signal.aborted) throw new OutputPreviewReadError("cancelled");
    const response = await fetch("/api/workflows/output-preview", {
      method: "POST", headers: { "content-type": "application/json" },
      credentials: "same-origin", cache: "no-store", redirect: "error", body, signal,
    });
    let result: PreviewResult;
    try { result = await readResult(response, signal); }
    catch (error) {
      if (signal.aborted) throw new OutputPreviewReadError("cancelled");
      if (error instanceof OutputPreviewReadError && error.reason === "capacity") throw error;
      if (response.status === 403) throw new OutputPreviewReadError("forbidden");
      if (response.status === 503) throw new OutputPreviewReadError("unavailable");
      throw error;
    }
    if (response.status === 403) throw new OutputPreviewReadError("forbidden");
    if (!result.ok) return result;
    if (!response.ok) throw new OutputPreviewReadError(response.status === 403 ? "forbidden" : response.status === 503 ? "unavailable" : "unknown");
    return result;
  } catch (error) {
    if (signal.aborted) throw new OutputPreviewReadError("cancelled");
    if (error instanceof OutputPreviewReadError) throw error;
    throw new OutputPreviewReadError("network");
  }
}

export function outputPreviewMessage(value: PreviewResult | OutputPreviewReadError): string {
  if (value instanceof OutputPreviewReadError) {
    const messages = {
      capacity: "试算响应超过容量限制，未采用返回内容。原填写已保留。",
      unknown: "无法核对试算响应，结果状态未知。原填写已保留，可手动重新试算。",
      forbidden: "试算请求被拒绝，请从本站页面重新核对。原填写已保留。",
      unavailable: "试算暂时不可用，原填写已保留，可稍后手动重试。",
      network: "试算连接中断，未取得可核对结果。原填写已保留，可手动重试。",
      cancelled: "已取消本次试算，原填写已保留。没有自动重新提交。",
    };
    return messages[value.reason];
  }
  if (value.ok) return "已取得本次参考数据的试算结构，请核对字段状态。";
  const messages = {
    invalid_request: "试算配置或参考值无效，请检查格式、字段位置和容量。",
    invalid_source: "交付来源无法采用，请核对流程中的可用业务步骤。",
    missing_source: "缺少必填参考成果，请补充参考值；空内容也可能无法作为交付。",
    invalid_result: "所选成果或组合结果无效，请核对结构和容量。",
    unsafe_data: "交付配置或试算结果包含凭据，已拒绝展示。请仅填写业务成果。",
    unavailable: "试算暂时不可用，原填写已保留，可稍后手动重试。",
  };
  return messages[value.code];
}
