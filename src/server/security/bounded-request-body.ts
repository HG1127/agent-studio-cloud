export type BoundedRequestTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "read_failed" };

export async function readBoundedRequestText(
  request: Pick<Request, "body" | "headers">,
  maxBytes: number,
): Promise<BoundedRequestTextResult> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
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
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "read_failed" };
  } finally {
    reader.releaseLock();
  }
}
