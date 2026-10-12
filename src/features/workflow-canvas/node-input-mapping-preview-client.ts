import {
  InputMappingPreviewFailure, InputMappingPreviewInput, InputMappingPreviewResult,
  MAX_INPUT_PREVIEW_BODY_BYTES, MAX_INPUT_PREVIEW_RESULT_BYTES,
  type InputMappingPreviewResult as PreviewResult,
} from "@/contracts/input-mapping-preview";
import { resolveInputValue, resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { jsonValuesEqual } from "@/server/domain/json-value";

export class InputMappingPreviewCancelledError extends Error {
  constructor() { super("Input mapping preview cancelled"); }
}
function checkCancelled(signal: AbortSignal) {
  if (signal.aborted) throw new InputMappingPreviewCancelledError();
}
function cancelBody(response: Response) { void response.body?.cancel().catch(() => undefined); }

async function readResult(response: Response, signal: AbortSignal): Promise<PreviewResult> {
  const declared = response.headers.get("content-length");
  const length = declared === null ? null : Number(declared);
  if (declared !== null && (!/^\d+$/.test(declared.trim()) || !Number.isSafeInteger(length) || length! > MAX_INPUT_PREVIEW_RESULT_BYTES)) {
    cancelBody(response); throw new Error("Invalid declared capacity");
  }
  if (response.redirected || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" || !response.body) {
    cancelBody(response); throw new Error("Unexpected response format");
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    checkCancelled(signal);
    while (true) {
      const { done, value } = await reader.read();
      checkCancelled(signal);
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INPUT_PREVIEW_RESULT_BYTES) throw new Error("Actual capacity exceeded");
      chunks.push(value);
    }
    // 浏览器解压后的正文长度不等于压缩传输的声明长度。
    const encoded = response.headers.get("content-encoding");
    if (length !== null && (!encoded || encoded.trim().toLowerCase() === "identity") && total !== length) throw new Error("Declared capacity mismatch");
    const data = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    checkCancelled(signal);
    return InputMappingPreviewResult.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)));
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (signal.aborted) throw new InputMappingPreviewCancelledError();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function previewNodeInputMapping(raw: unknown, signal: AbortSignal = new AbortController().signal): Promise<PreviewResult> {
  const unavailable = () => InputMappingPreviewFailure.parse({
    ok: false, executed: false, scope: "field-mapping", code: "unavailable",
    error: "参考试算暂时无法读取，请稍后重新提交。没有执行步骤或保存设置。", fields: [],
  });
  const invalid = () => InputMappingPreviewFailure.parse({
    ok: false, executed: false, scope: "field-mapping", code: "invalid_request",
    error: "映射或样例格式、容量未通过校验，请核对后再试算。", fields: [],
  });
  checkCancelled(signal);
  let snapshot: InputMappingPreviewInput;
  let body: string;
  try {
    const input = InputMappingPreviewInput.safeParse(raw);
    if (!input.success) return invalid();
    body = JSON.stringify(input.data);
    if (new TextEncoder().encode(body).byteLength > MAX_INPUT_PREVIEW_BODY_BYTES) return invalid();
    snapshot = InputMappingPreviewInput.parse(JSON.parse(body));
  } catch { return invalid(); }
  try {
    checkCancelled(signal);
    const response = await fetch("/api/workflows/input-preview", {
      method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error", signal,
      headers: { "content-type": "application/json" }, body,
    });
    if (signal.aborted) { cancelBody(response); throw new InputMappingPreviewCancelledError(); }
    const result = await readResult(response, signal);
    checkCancelled(signal);
    if (result.ok) {
      const resolved = resolveNodeInput({ node: { title: "字段试算", inputMapping: snapshot.mapping }, input: snapshot.input, outputs: snapshot.outputs });
      const fields = snapshot.mapping.fields.map((binding) => ({
        target: binding.target, status: resolveInputValue(binding.source, snapshot.input, snapshot.outputs) !== undefined ? "provided"
          : binding.fallback !== undefined ? "fallback" : binding.required ? "missing" : "omitted",
      }));
      if (response.status !== 200 || result.includesUpstreamOutputs !== snapshot.mapping.includeUpstreamOutputs
        || !jsonValuesEqual(result.fields, fields) || !resolved.ok
        || !jsonValuesEqual(result.input, resolved.input) || !jsonValuesEqual(result.outputs, resolved.outputs)) return unavailable();
    }
    return result;
  } catch (error) {
    if (signal.aborted || error instanceof InputMappingPreviewCancelledError) throw new InputMappingPreviewCancelledError();
    return unavailable();
  }
}
