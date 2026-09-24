import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { WaitEventPayload } from "@/contracts/run";
import { runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const Params = z.object({
  runId: z.string().uuid(),
  eventKey: z.string().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/),
});

export async function POST(req: Request, { params }: { params: Promise<{ runId: string; eventKey: string }> }) {
  const parsedParams = Params.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ ok: false, error: "消息参数不正确" }, { status: 400 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  const payload = WaitEventPayload.safeParse(raw);
  if (!payload.success) {
    return Response.json({ ok: false, error: "消息内容必须是 JSON 对象" }, { status: 400 });
  }
  const { runId, eventKey } = parsedParams.data;
  const [run] = await db
    .select({ status: runs.status })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
    .limit(1);
  if (!run) return Response.json({ ok: false, error: "找不到这次运行" }, { status: 404 });
  if (run.status !== "waiting_event") {
    return Response.json({ ok: false, error: "这次运行当前没有等待外部消息" }, { status: 409 });
  }
  try {
    await resumeHook(`wait:${runId}:${eventKey}`, payload.data);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("恢复等待中的运行失败", error);
    return Response.json({ ok: false, error: "消息未匹配到等待步骤，或已经处理过" }, { status: 409 });
  }
}
