import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { WaitEventPayload } from "@/contracts/run";
import { runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { getPendingWait, getPendingWaitHook } from "@/server/queries/runs";

export const dynamic = "force-dynamic";

const Params = z.object({
  runId: z.string().uuid(),
  eventKey: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/),
});
const MAX_PAYLOAD_BYTES = 256 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ runId: string; eventKey: string }> }) {
  const parsedParams = Params.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ ok: false, error: "消息参数不正确" }, { status: 400 });
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_BYTES) {
    return Response.json({ ok: false, error: "消息内容超过 256KB 限制" }, { status: 413 });
  }
  let body: string;
  try {
    body = await req.text();
  } catch {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  if (new TextEncoder().encode(body).byteLength > MAX_PAYLOAD_BYTES) {
    return Response.json({ ok: false, error: "消息内容超过 256KB 限制" }, { status: 413 });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  const payload = WaitEventPayload.safeParse(raw);
  if (!payload.success) {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  const { runId, eventKey } = parsedParams.data;
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
    console.error("读取等待消息状态失败", error);
    return Response.json({ ok: false, error: "暂时无法读取等待状态，请稍后重试" }, { status: 500 });
  }
  if (!run) return Response.json({ ok: false, error: "找不到这次运行" }, { status: 404 });
  if (run.status !== "waiting_event") {
    return Response.json({ ok: false, error: "这次运行当前没有等待外部消息" }, { status: 409 });
  }
  if (!pendingWait || pendingWait.eventKey !== eventKey) {
    return Response.json({ ok: false, error: "消息未匹配到当前等待步骤" }, { status: 409 });
  }
  const payloadError = validateJsonObjectSchema(payload.data, pendingWait.payloadSchema);
  if (payloadError) {
    return Response.json({ ok: false, error: payloadError }, { status: 400 });
  }
  try {
    await resumeHook(pendingHook?.hookToken ?? `wait:${runId}:${eventKey}`, payload.data);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("恢复等待中的运行失败", error);
    return Response.json({ ok: false, error: "消息未匹配到等待步骤，或已经处理过" }, { status: 409 });
  }
}
