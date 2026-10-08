export type BoundedRequestTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "read_failed" };

export type BoundedRequestBytesResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too_large" | "read_failed" };

export async function readBoundedRequestBytes(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<BoundedRequestBytesResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, bytes: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("请求内容超过大小限制").catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: "read_failed" };
  } finally {
    reader.releaseLock();
  }
}

export async function readBoundedRequestText(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<BoundedRequestTextResult> {
  const result = await readBoundedRequestBytes(request, maxBytes);
  if (!result.ok) return result;
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(result.bytes) };
  } catch {
    return { ok: false, reason: "read_failed" };
  }
}
