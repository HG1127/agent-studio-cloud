import { AgentExportFile } from "@/contracts/agent";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getAgentDetail } from "@/server/queries/agents";
import { queryUnavailableResponse, SafeQueryError, withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  let detail: Awaited<ReturnType<typeof getAgentDetail>>;
  try {
    detail = await withSafeQueryError(() => getAgentDetail(agentId, DEMO_WORKSPACE_ID), "agent-export");
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  if (!detail?.draft) return Response.json({ ok: false, error: "找不到可导出的助手流程" }, { status: 404 });
  const payload = AgentExportFile.safeParse({
    format: "agent-studio-cloud",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    agent: {
      name: detail.agent.name,
      description: detail.agent.description,
      intentText: detail.agent.intentText,
    },
    workflow: detail.draft,
  });
  if (!payload.success) {
    return Response.json(
      { ok: false, error: "助手资料不符合当前导出格式，请先检查名称、说明和业务目标" },
      { status: 422 },
    );
  }
  const filename = `${detail.agent.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 50) || "agent"}.json`;
  return new Response(JSON.stringify(payload.data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
