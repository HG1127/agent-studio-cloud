import { AgentManifest } from "@/contracts/manifest";
import { VersionExportFile } from "@/contracts/version";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getVersionExportSource } from "@/server/queries/versions";
import { queryUnavailableResponse, SafeQueryError, withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

function safeFilename(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 50) || "agent";
}

export async function GET(_request: Request, context: { params: Promise<{ agentId: string; versionId: string }> }) {
  const { agentId, versionId } = await context.params;
  let source: Awaited<ReturnType<typeof getVersionExportSource>>;
  try {
    source = await withSafeQueryError(
      () => getVersionExportSource(agentId, versionId, DEMO_WORKSPACE_ID),
      "version-export",
    );
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  const manifest = source ? AgentManifest.safeParse(source.manifest) : null;
  if (!source || !manifest?.success) {
    return Response.json({ ok: false, error: "找不到可导出的版本" }, { status: 404 });
  }
  const payload = VersionExportFile.safeParse({
    format: "agent-studio-cloud-version",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    agent: { name: source.agentName },
    version: { number: source.version, status: source.status, createdAt: source.createdAt.toISOString() },
    manifest: manifest.data,
  });
  if (!payload.success) {
    return Response.json(
      { ok: false, error: "版本资料不符合当前导出格式，请先检查助手名称" },
      { status: 422 },
    );
  }
  const filename = `${safeFilename(source.agentName)}-版本-${source.version}.json`;
  return new Response(JSON.stringify(payload.data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
