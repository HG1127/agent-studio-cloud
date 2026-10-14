import { InputMappingPreviewFailure, InputMappingPreviewResult, MAX_INPUT_PREVIEW_BODY_BYTES } from "@/contracts/input-mapping-preview";
import { getInputMappingPreview } from "@/server/queries/input-mapping-preview";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import { hasSameOrigin } from "@/server/security/request-origin";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };
function rejected(status: number, error: string, code: "invalid_request" | "unavailable" = "invalid_request") {
  return Response.json(InputMappingPreviewFailure.parse({ ok: false, executed: false, scope: "field-mapping", code, error, fields: [] }), { status, headers: noStore });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request) || request.headers.get("sec-fetch-site") === "cross-site") return rejected(403, "请从本站提交字段试算");
  if (new URL(request.url).search) return rejected(400, "字段试算不接受额外查询参数");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return rejected(415, "字段试算须使用 JSON");
  const body = await readBoundedRequestText(request, MAX_INPUT_PREVIEW_BODY_BYTES);
  if (!body.ok) return rejected(body.reason === "too_large" ? 413 : 400, "字段试算无法安全读取，请检查编码和容量");
  let raw: unknown;
  try { raw = JSON.parse(body.text); } catch { return rejected(400, "字段试算不是有效 JSON"); }
  try {
    const result = InputMappingPreviewResult.parse(await getInputMappingPreview(raw));
    const status = result.ok ? 200 : result.code === "unavailable" ? 503 : result.code === "invalid_request" ? 400 : 422;
    return Response.json(result, { status, headers: noStore });
  } catch {
    return rejected(503, "字段试算暂时不可用，请稍后重试", "unavailable");
  }
}
