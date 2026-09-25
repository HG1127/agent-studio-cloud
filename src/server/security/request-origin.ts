export function hasCrossSiteOrigin(request: Pick<Request, "headers" | "url">): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin !== new URL(request.url).origin);
}
