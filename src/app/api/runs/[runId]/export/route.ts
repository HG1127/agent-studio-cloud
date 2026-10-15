import { RunReportFile, RunStepReport } from "@/contracts/run";
import { z } from "zod";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { redactRunReportData, redactSensitiveData } from "@/server/domain/security/redact-sensitive";
import { getRunContext, getRunView, listApprovalsForReport, listRunStepsForReport } from "@/server/queries/runs";
import { getLatestTraceSeq, listTraceSince } from "@/server/queries/trace";
import { parseQueryRows } from "@/server/queries/parse-query-rows";
import { getRunFeedbackForReport } from "@/server/queries/run-feedback";
import { queryUnavailableResponse, SafeQueryError, withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

function safeFilename(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 50) || "run";
}

function streamedRunReport(
  report: RunReportFile,
  firstTraceBatch: Awaited<ReturnType<typeof listTraceSince>>,
  maxTraceSeq: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const redacted = redactRunReportData({ ...report, trace: [] });
  const approvals = redacted.approvals;
  const head = { ...redacted, trace: undefined, approvals: undefined, integrity: undefined };
  let prefix = `${JSON.stringify(head).slice(0, -1)},"trace":[`;
  let batch = firstTraceBatch;
  let cursor = 0;
  let omittedTraceEvents = batch.scannedCount - batch.events.length;
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
        const chunk = batch.events
          .map((event, index) => `${firstEvent && index === 0 ? "" : ","}${JSON.stringify(redactSensitiveData(event))}`)
          .join("");
        firstEvent = false;
        controller.enqueue(encoder.encode(chunk));
      }
      cursor = batch.nextCursor;
      if (batch.scannedCount > 0) {
        batch = await withSafeQueryError(
          () => listTraceSince(report.run.id, DEMO_WORKSPACE_ID, cursor, maxTraceSeq),
          "run-export-trace",
        );
        omittedTraceEvents += batch.scannedCount - batch.events.length;
        return;
      }
      if (!finished) {
        const tail = `],"approvals":${JSON.stringify(approvals)},"integrity":${JSON.stringify({
          omittedSteps: report.integrity?.omittedSteps ?? 0,
          omittedTraceEvents,
          omittedApprovals: report.integrity?.omittedApprovals ?? 0,
          omittedFeedback: report.integrity?.omittedFeedback ?? 0,
        })}}`;
        controller.enqueue(encoder.encode(tail));
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
  if (!z.string().uuid().safeParse(runId).success) {
    return Response.json({ ok: false, error: "导出参数不正确" }, { status: 400 });
  }
  let run: Awaited<ReturnType<typeof getRunView>>;
  try {
    run = await withSafeQueryError(() => getRunView(runId, DEMO_WORKSPACE_ID), "run-export");
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  if (!run) return Response.json({ ok: false, error: "找不到这次运行" }, { status: 404 });

  let reportSource: Awaited<ReturnType<typeof Promise.all<[
    ReturnType<typeof getRunContext>,
    ReturnType<typeof listRunStepsForReport>,
    ReturnType<typeof getLatestTraceSeq>,
    ReturnType<typeof listApprovalsForReport>,
    ReturnType<typeof getRunFeedbackForReport>,
  ]>>>;
  try {
    reportSource = await withSafeQueryError(() => Promise.all([
      getRunContext(runId, DEMO_WORKSPACE_ID),
      listRunStepsForReport(runId, DEMO_WORKSPACE_ID),
      getLatestTraceSeq(runId, DEMO_WORKSPACE_ID),
      listApprovalsForReport(runId, DEMO_WORKSPACE_ID),
      getRunFeedbackForReport(runId, DEMO_WORKSPACE_ID),
    ]), "run-export-related");
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  const [runContext, stepResult, maxTraceSeq, approvalResult, feedbackResult] = reportSource;
  let firstTraceBatch: Awaited<ReturnType<typeof listTraceSince>>;
  try {
    firstTraceBatch = await withSafeQueryError(
      () => listTraceSince(runId, DEMO_WORKSPACE_ID, 0, maxTraceSeq),
      "run-export-trace-open",
    );
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  const steps = parseQueryRows("运行报告步骤", RunStepReport, stepResult.steps.map((step) => ({
    nodeId: step.nodeId,
    nodeTitle: step.nodeTitle,
    nodeType: step.nodeType,
    status: step.status,
    attempt: step.attempt,
    output: step.output,
    error: step.error,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
  })));
  const report = RunReportFile.safeParse({
    format: "agent-studio-cloud-run",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    run,
    context: runContext,
    steps,
    trace: [],
    approvals: approvalResult.approvals,
    feedback: feedbackResult.feedback,
    integrity: {
      omittedSteps: stepResult.omittedCount + stepResult.steps.length - steps.length,
      omittedTraceEvents: 0,
      omittedApprovals: approvalResult.omittedCount,
      omittedFeedback: feedbackResult.omittedCount,
    },
  });
  if (!report.success) {
    return Response.json({ ok: false, error: "运行报告包含无法导出的历史数据" }, { status: 422 });
  }
  const date = (run.finishedAt ?? run.startedAt ?? report.data.exportedAt).slice(0, 10);
  const filename = `${safeFilename(run.agentName)}-${date}-运行报告.json`;
  // 运行上下文与步骤结果可以超过函数的普通响应上限，下载必须保持流式传输。
  return new Response(streamedRunReport(report.data, firstTraceBatch, maxTraceSeq), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
