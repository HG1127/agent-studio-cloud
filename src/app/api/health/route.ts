import { sql } from "drizzle-orm";
import { getRun } from "workflow/api";
import { HealthResponse } from "@/contracts/health";
import { db } from "@/lib/db";

// 探针 run 永远不会被创建：运行时能回答「未找到」即代表连接与配置正常
const HEALTH_PROBE_RUN_ID = "health-probe-run";

export async function GET() {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  let workflowOk = false;
  try {
    workflowOk = !(await getRun(HEALTH_PROBE_RUN_ID).exists);
  } catch {
    workflowOk = false;
  }
  const ok = dbOk && workflowOk;
  const body = HealthResponse.parse({ ok, db: dbOk, workflow: workflowOk });
  return Response.json(body, { status: ok ? 200 : 503 });
}
