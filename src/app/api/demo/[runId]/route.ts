import { getRun } from "workflow/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!(await run.exists)) {
    return Response.json({ error: "未找到该运行" }, { status: 404 });
  }
  const status = await run.status;
  if (status === "completed") {
    return Response.json({
      runId,
      status: "completed",
      result: await run.returnValue,
    });
  }
  if (status === "running" || status === "pending") {
    return Response.json({ runId, status: "running" });
  }
  return Response.json({ runId, status: "failed" });
}
