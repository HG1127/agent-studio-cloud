import { start } from "workflow/api";
import { demoWorkflow } from "@/server/workflows/demo";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  const run = await start(demoWorkflow, [body.name ?? "世界"]);
  return Response.json({ runId: run.runId });
}
