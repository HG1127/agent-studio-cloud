import { publicToolAdminCredentialMatches } from "@/server/domain/public-agent-tool";

export function publicToolBearer(request: Pick<Request, "headers" | "url">): string | null {
  const url = new URL(request.url);
  if (url.search) return null;
  const value = request.headers.get("authorization");
  const match = value && /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(value);
  return match ? match[1] : null;
}
export function publicToolAdminAuthorized(token: string): boolean {
  return publicToolAdminCredentialMatches(token, process.env.PUBLIC_AGENT_TOOLS_ADMIN_TOKEN);
}
export function publicToolBrowserRequestAllowed(request: Pick<Request, "headers" | "url">): boolean {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site"
    && (!origin || origin === new URL(request.url).origin);
}
