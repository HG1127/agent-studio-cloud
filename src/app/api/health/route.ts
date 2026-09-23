import { sql } from "drizzle-orm";
import { getRun } from "workflow/api";
import { WorkflowRunNotFoundError } from "workflow/errors";
import { HealthResponse } from "@/contracts/health";
import { db } from "@/lib/db";

// 探针 run 永远不会被创建：运行时能回答「未找到」即代表连接与配置正常。
// 格式必须符合平台 wrun_+ULID 约定，否则平台 API 直接 400（本地引擎不校验格式，故仅在 Vercel 暴露）
const HEALTH_PROBE_RUN_ID = "wrun_00000000000000000000000000";

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
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error)) {
      // 平台对不存在的 run 抛「未找到」——确定的否定回答同样是探针通过
      workflowOk = true;
    } else {
      console.error("[health-workflow] 探针失败：", error, {
        VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? null,
        VERCEL_URL: process.env.VERCEL_URL ?? null,
      });
    }
  }
  const ok = dbOk && workflowOk;
  const body = HealthResponse.parse({ ok, db: dbOk, workflow: workflowOk });
  return Response.json(body, { status: ok ? 200 : 503 });
}
