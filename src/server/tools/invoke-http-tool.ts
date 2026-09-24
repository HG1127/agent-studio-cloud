import type { ToolRegistration } from "@/server/tools/tool-registry";

const MAX_TOOL_REQUEST_BYTES = 512 * 1024;
const MAX_TOOL_RESPONSE_BYTES = 1024 * 1024;
const TOOL_TIMEOUT_MS = 30_000;

export type ToolInvocationResult =
  | { ok: true; output: Record<string, unknown> }
  | { ok: false; error: string; retryable: boolean };

async function readBoundedBody(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_TOOL_RESPONSE_BYTES) return null;
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_TOOL_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function invokeHttpTool(args: {
  tool: ToolRegistration;
  idempotencyKey: string;
  action: string;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<ToolInvocationResult> {
  const payload = { action: args.action, input: args.input, outputs: args.outputs };
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return { ok: false, error: "工具输入无法转换为 JSON", retryable: false };
  }
  if (new TextEncoder().encode(body).byteLength > MAX_TOOL_REQUEST_BYTES) {
    return { ok: false, error: "工具输入超过 512 KB，请缩小上游结果后重试", retryable: false };
  }
  const headers = new Headers(args.tool.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("accept", "application/json");
  headers.set("idempotency-key", args.idempotencyKey);
  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(args.tool.endpoint, {
      method: args.tool.method,
      headers,
      body,
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    return { ok: false, error: "业务系统暂时无法连接，稍后自动重试", retryable: true };
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: "业务系统拒绝访问，请检查服务端工具凭据", retryable: false };
    }
    const retryable = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
    return {
      ok: false,
      error: retryable ? "业务系统暂时不可用，稍后自动重试" : `业务系统拒绝了请求（${response.status}）`,
      retryable,
    };
  }
  const raw = await readBoundedBody(response);
  if (raw === null) return { ok: false, error: "业务系统返回内容超过 1 MB", retryable: false };
  if (!raw.trim()) return { ok: true, output: { ok: true } };
  try {
    const output: unknown = JSON.parse(raw);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      return { ok: false, error: "业务系统返回的不是 JSON 对象", retryable: false };
    }
    return { ok: true, output: output as Record<string, unknown> };
  } catch {
    return { ok: false, error: "业务系统返回的不是有效 JSON", retryable: false };
  }
}
