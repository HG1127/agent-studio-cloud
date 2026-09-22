import { start } from "workflow/api";
import { DemoStartInput } from "@/contracts/demo";
import { demoWorkflow } from "@/server/workflows/demo";

export async function POST(request: Request) {
  const parsed = DemoStartInput.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "请输入 1–500 字的任务描述" }, { status: 400 });
  }
  try {
    const run = await start(demoWorkflow, [parsed.data.message]);
    return Response.json({ runId: run.runId });
  } catch (error) {
    console.error("demo 工作流启动失败", error);
    return Response.json({ error: "任务启动失败，请稍后重试" }, { status: 500 });
  }
}
