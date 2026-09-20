import { getRun } from "workflow/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const run = getRun(runId);
  const result = await run.returnValue;
  return Response.json({ runId, status: "completed", result });
}
