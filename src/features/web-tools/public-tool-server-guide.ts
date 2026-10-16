import { PublicToolReference } from "@/contracts/public-agent-tool";

export const SERVER_GUIDE_REQUEST_ID = "请填写并保留同一次请求的UUID";

function shellQuote(value: string) { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }

export function buildPublicToolServerGuide(address: string, toolId: string) {
  const reference = PublicToolReference.safeParse({ toolId });
  if (!reference.success) return { ok: false as const, error: "当前工具标识无法核对，请重新读取工具。" };
  let url: URL;
  try { url = new URL(address.trim()); }
  catch { return { ok: false as const, error: "请填写完整的服务端站点地址。" }; }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (address.length > 2048 || /\s/u.test(address.trim())
    || Array.from(address.trim()).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || url.username || url.password
    || url.search || url.hash || url.pathname !== "/"
    || !/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/iu.test(url.hostname)
    || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    return { ok: false as const, error: "请只填写 HTTPS 站点地址，不含账号、密码、路径、查询参数或片段；本机调试可用 HTTP。" };
  }
  const endpoint = url.origin + "/api/public-tools/" + reference.data.toolId + "/calls";
  const authorization = '"Authorization: Bearer ${PUBLIC_TOOL_TOKEN:?请先在服务端配置工具调用凭据}"';
  const curlPost = ["curl --max-time 30 --fail-with-body --request POST " + shellQuote(endpoint),
    "--header " + authorization, "--header 'Content-Type: application/json'", "--data-binary '@request.json'"].join(" \\\n  ");
  const curlGet = ["curl --max-time 30 --fail-with-body --request GET " + shellQuote(endpoint)
    + '"/${PUBLIC_TOOL_REQUEST_ID:?请使用request.json中同一次请求的UUID}"', "--header " + authorization].join(" \\\n  ");
  function nodeExample(readOnly: boolean) {
    const target = JSON.stringify(endpoint);
    return [
      'import { readFile } from "node:fs/promises";',
      'const token = process.env.PUBLIC_TOOL_TOKEN;',
      'if (!token) throw new Error("请先在服务端配置工具调用凭据，不要使用管理凭据");',
      'const request = JSON.parse(await readFile(new URL("./request.json", import.meta.url), "utf8"));',
      "if (typeof request.requestId !== \"string\" || request.requestId === " + JSON.stringify(SERVER_GUIDE_REQUEST_ID) + ")",
      '  throw new Error("请先填写request.json；首次生成UUID后，核对与重试始终使用原请求");',
      "try {",
      "  const response = await fetch(" + target + (readOnly ? ' + "/" + encodeURIComponent(request.requestId)' : "") + ", {",
      '    method: "' + (readOnly ? "GET" : "POST") + '", redirect: "error", signal: AbortSignal.timeout(30000),',
      '    headers: { Authorization: "Bearer " + token' + (readOnly ? " }," : ', "Content-Type": "application/json" },'),
      ...(readOnly ? [] : ["    body: JSON.stringify(request),"]),
      "  });",
      "  const result = await response.json();",
      "  console.log(JSON.stringify(result, null, 2));",
      "  if (!response.ok || !result.ok) process.exitCode = 1;",
      "} catch {",
      '  console.error("本次状态未能确认，请保留原请求并只读查询；不要自动重发或更换UUID。");',
      "  process.exitCode = 1;",
      "}",
    ].join("\n");
  }
  return { ok: true as const, origin: url.origin, local, endpoint, curlPost, curlGet,
    nodePost: nodeExample(false), nodeGet: nodeExample(true),
    requestJson: JSON.stringify({ requestId: SERVER_GUIDE_REQUEST_ID, input: {} }, null, 2) };
}
