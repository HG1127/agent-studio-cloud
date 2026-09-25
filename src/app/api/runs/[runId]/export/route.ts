import { RunReportFile, RunStepReport } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";
import { getRunContext, getRunView, listApprovals, listRunSteps } from "@/server/queries/runs";
import { listTraceSince } from "@/server/queries/trace";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

export const dynamic = "force-dynamic";

function safeFilename(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 50) || "run";
}

function streamedRunReport(
  report: RunReportFile,
  firstTraceBatch: Awaited<ReturnType<typeof listTraceSince>>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const redacted = redactSensitiveData({ ...report, trace: [] }) as RunReportFile;
  const approvals = redacted.approvals;
  const head = { ...redacted, trace: undefined, approvals: undefined };
  let prefix = `${JSON.stringify(head).slice(0, -1)},"trace":[`;
  let tail = `],"approvals":${JSON.stringify(approvals)}}`;
  let batch = firstTraceBatch;
  let cursor = 0;
  let firstEvent = true;
  let finished = false;
  return new ReadableStream({
    async pull(controller) {
      if (prefix) {
        controller.enqueue(encoder.encode(prefix));
        prefix = "";
        return;
      }
      if (batch.events.length > 0) {
        const chunk = batch.events.map((event) => `${firstEvent ? "" : ","}${JSON.stringify(event)}`).join("");
        firstEvent = false;
        controller.enqueue(encoder.encode(chunk));
      }
      cursor = batch.nextCursor;
      if (batch.scannedCount > 0) {
        batch = await listTraceSince(report.run.id, DEMO_WORKSPACE_ID, cursor);
        return;
      }
      if (!finished) {
        controller.enqueue(encoder.encode(tail));
        tail = "";
        finished = true;
        return;
      }
      if (finished) {
        controller.close();
      }
    },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const run = await getRunView(runId, DEMO_WORKSPACE_ID);
  if (!run) return Response.json({ ok: false, error: "找不到这次运行" }, { status: 404 });

  const [runContext, steps, firstTraceBatch, approvals] = await Promise.all([
    getRunContext(runId, DEMO_WORKSPACE_ID),
    listRunSteps(runId, DEMO_WORKSPACE_ID),
    listTraceSince(runId, DEMO_WORKSPACE_ID, 0),
    listApprovals(runId, DEMO_WORKSPACE_ID),
  ]);
  const report = RunReportFile.safeParse({
    format: "agent-studio-cloud-run",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    run,
    context: runContext,
    steps: parseQueryRows("运行报告步骤", RunStepReport, steps.map((step) => ({
      nodeId: step.nodeId,
      nodeTitle: step.nodeTitle,
      nodeType: step.nodeType,
      status: step.status,
      attempt: step.attempt,
      output: step.output,
      error: step.error,
      startedAt: step.startedAt?.toISOString() ?? null,
      finishedAt: step.finishedAt?.toISOString() ?? null,
    }))),
    trace: [],
    approvals,
  });
  if (!report.success) {
    return Response.json({ ok: false, error: "运行报告包含无法导出的历史数据" }, { status: 422 });
  }
  const date = (run.finishedAt ?? run.startedAt ?? report.data.exportedAt).slice(0, 10);
  const filename = `${safeFilename(run.agentName)}-${date}-运行报告.json`;
  // 运行上下文与步骤结果可以超过函数的普通响应上限，下载必须保持流式传输。
  return new Response(streamedRunReport(report.data, firstTraceBatch), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
