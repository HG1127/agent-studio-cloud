import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { MAX_WAIT_EVENT_PAYLOAD_BYTES, WaitEventPayload } from "@/contracts/run";
import { runs, type WaitEventSubmission } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { getPendingWait, getPendingWaitHook } from "@/server/queries/runs";
import { hasCrossSiteOrigin, hasSameOrigin } from "@/server/security/request-origin";
import { matchesWaitEventToken } from "@/server/security/wait-event-token";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { readBoundedRequestText } from "@/server/security/bounded-request-body";
import {
  claimWaitEventSubmission,
  findWaitEventSubmission,
  markWaitEventSubmissionAccepted,
  waitEventSubmissionMatches,
  waitEventOutcome,
} from "@/server/services/wait-event-submission";

export const dynamic = "force-dynamic";

const Params = z.object({
  runId: z.string().uuid(),
  eventKey: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/),
});

export async function POST(req: Request, { params }: { params: Promise<{ runId: string; eventKey: string }> }) {
  if (hasCrossSiteOrigin(req)) {
    return Response.json({ ok: false, error: "不允许从其他站点提交消息" }, { status: 403 });
  }
  const parsedParams = Params.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ ok: false, error: "消息参数不正确" }, { status: 400 });
  }
  const bodyResult = await readBoundedRequestText(req, MAX_WAIT_EVENT_PAYLOAD_BYTES);
  if (!bodyResult.ok && bodyResult.reason === "too_large") {
    return Response.json({ ok: false, error: "消息内容超过 256KB 限制" }, { status: 413 });
  }
  if (!bodyResult.ok) {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bodyResult.text);
  } catch {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  const payload = WaitEventPayload.safeParse(raw);
  if (!payload.success) {
    const error = raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? payload.error.issues[0]?.message ?? "消息内容不正确"
      : "消息内容必须是 JSON 对象";
    return Response.json({ ok: false, error }, { status: 400 });
  }
  const { runId, eventKey } = parsedParams.data;
  const submissionToken = req.headers.get("x-wait-event-token");
  let processingReceipt: WaitEventSubmission | null = null;
  if (submissionToken) {
    try {
      const receipt = await findWaitEventSubmission(submissionToken);
      if (receipt) {
        if (!waitEventSubmissionMatches(receipt, { runId, eventKey, payload: payload.data })) {
          return Response.json({ ok: false, error: "这项提交凭据已经用于另一条消息" }, { status: 409 });
        }
        if (receipt.status === "accepted") return Response.json({ ok: true });
        const outcome = await waitEventOutcome(receipt.runId, receipt.hookToken);
        if (outcome === "resumed") {
          await markWaitEventSubmissionAccepted(receipt.id, receipt.attemptToken);
          return Response.json({ ok: true });
        }
        if (outcome === "timed_out") {
          return Response.json({ ok: false, error: "等待已超时，消息未被接收" }, { status: 409 });
        }
        processingReceipt = receipt;
      }
    } catch (error) {
      console.error("读取等待消息回执失败", safeErrorForLog(error));
      return Response.json({ ok: false, error: "暂时无法读取消息提交状态，请稍后重试" }, { status: 500 });
    }
  }
  let run: { status: string } | undefined;
  let pendingWait: Awaited<ReturnType<typeof getPendingWait>>;
  let pendingHook: Awaited<ReturnType<typeof getPendingWaitHook>>;
  try {
    [run] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    pendingWait = run?.status === "waiting_event" ? await getPendingWait(runId, DEMO_WORKSPACE_ID) : null;
    pendingHook = run?.status === "waiting_event" ? await getPendingWaitHook(runId, DEMO_WORKSPACE_ID) : null;
  } catch (error) {
    console.error("读取等待消息状态失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "暂时无法读取等待状态，请稍后重试" }, { status: 500 });
  }
  if (!run) return Response.json({ ok: false, error: "找不到这次运行" }, { status: 404 });
  if (run.status !== "waiting_event") {
    if (processingReceipt && ["running", "completed"].includes(run.status)) {
      // 运行也可能因等待超时而前进；没有该次等待的恢复轨迹，不能确认消息已被接收。
      return Response.json(
        { ok: false, error: "消息提交结果仍在确认，请稍后使用相同内容重试" },
        { status: 503, headers: { "retry-after": "2" } },
      );
    }
    return Response.json({ ok: false, error: "这次运行当前没有等待外部消息" }, { status: 409 });
  }
  if (!pendingWait || pendingWait.eventKey !== eventKey) {
    return Response.json({ ok: false, error: "消息未匹配到当前等待步骤" }, { status: 409 });
  }
  if (pendingHook?.submissionToken && !matchesWaitEventToken(submissionToken, pendingHook.submissionToken)) {
    return Response.json({ ok: false, error: "消息提交凭据无效，请刷新页面后重试" }, { status: 403 });
  }
  if (!pendingHook?.submissionToken && !hasSameOrigin(req)) {
    return Response.json({ ok: false, error: "这条旧运行只能从当前页面提交消息" }, { status: 403 });
  }
  const payloadError = validateJsonObjectSchema(payload.data, pendingWait.payloadSchema);
  if (payloadError) {
    return Response.json({ ok: false, error: payloadError }, { status: 400 });
  }
  let claimed: Awaited<ReturnType<typeof claimWaitEventSubmission>> | null = null;
  if (pendingHook?.submissionToken) {
    try {
      claimed = await claimWaitEventSubmission({
        runId,
        eventKey,
        submissionToken: pendingHook.submissionToken,
        payload: payload.data,
        hookToken: pendingHook.hookToken,
      });
    } catch (error) {
      console.error("保存等待消息回执失败", safeErrorForLog(error));
      return Response.json({ ok: false, error: "暂时无法保存消息，请稍后重试" }, { status: 500 });
    }
    if (claimed.state === "accepted") return Response.json({ ok: true });
    if (claimed.state === "conflict") {
      return Response.json({ ok: false, error: "这项提交凭据已经用于另一条消息" }, { status: 409 });
    }
    if (claimed.state === "processing") {
      return Response.json(
        { ok: false, error: "消息正在处理，请稍后使用相同内容重试" },
        { status: 503, headers: { "retry-after": "2" } },
      );
    }
  }
  try {
    const hookToken = claimed?.state === "claimed"
      ? claimed.hookToken
      : pendingHook?.hookToken ?? `wait:${runId}:${eventKey}`;
    const resumePayload = claimed?.state === "claimed" ? claimed.payload : payload.data;
    await resumeHook(hookToken, resumePayload);
    if (claimed?.state === "claimed") {
      try {
        await markWaitEventSubmissionAccepted(claimed.id, claimed.attemptToken);
      } catch (error) {
        console.error("确认等待消息回执失败", safeErrorForLog(error));
      }
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("恢复等待中的运行失败", safeErrorForLog(error));
    if (claimed?.state === "claimed") {
      try {
        const outcome = await waitEventOutcome(runId, claimed.hookToken);
        if (outcome === "resumed") {
          await markWaitEventSubmissionAccepted(claimed.id, claimed.attemptToken);
          return Response.json({ ok: true });
        }
        if (outcome === "timed_out") {
          return Response.json({ ok: false, error: "等待已超时，消息未被接收" }, { status: 409 });
        }
      } catch (verifyError) {
        console.error("确认等待消息恢复结果失败", safeErrorForLog(verifyError));
      }
      return Response.json(
        { ok: false, error: "消息提交结果仍在确认，请稍后使用相同内容重试" },
        { status: 503, headers: { "retry-after": "2" } },
      );
    }
    return Response.json({ ok: false, error: "消息未匹配到等待步骤，或已经处理过" }, { status: 409 });
  }
}
