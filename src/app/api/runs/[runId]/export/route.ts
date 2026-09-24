import { RunReportFile } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRunContext, getRunView, listApprovals, listRunSteps } from "@/server/queries/runs";
import { listTrace } from "@/server/queries/trace";

export const dynamic = "force-dynamic";

function safeFilename(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 50) || "run";
}

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getRunView(runId, DEMO_WORKSPACE_ID);
  if (!run) return Response.json({ ok: false, error: "找不到这次运行" }, { status: 404 });

  const [runContext, steps, trace, approvals] = await Promise.all([
    getRunContext(runId, DEMO_WORKSPACE_ID),
    listRunSteps(runId, DEMO_WORKSPACE_ID),
    listTrace(runId, DEMO_WORKSPACE_ID),
    listApprovals(runId, DEMO_WORKSPACE_ID),
  ]);
  const report = RunReportFile.parse({
    format: "agent-studio-cloud-run",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    run,
    context: runContext,
    steps: steps.map((step) => ({
      nodeId: step.nodeId,
      nodeTitle: step.nodeTitle,
      nodeType: step.nodeType,
      status: step.status,
      attempt: step.attempt,
      output: step.output,
      error: step.error,
      startedAt: step.startedAt?.toISOString() ?? null,
      finishedAt: step.finishedAt?.toISOString() ?? null,
    })),
    trace,
    approvals,
  });
  const date = (run.finishedAt ?? run.startedAt ?? report.exportedAt).slice(0, 10);
  const filename = `${safeFilename(run.agentName)}-${date}-运行报告.json`;
  return new Response(JSON.stringify(report, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
