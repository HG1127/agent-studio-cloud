import { getRun } from "workflow/api";
import { WorkflowRunNotFoundError } from "workflow/errors";
import { HealthResponse } from "@/contracts/health";
import { isDatabaseReady } from "@/server/queries/system-health";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export const dynamic = "force-dynamic";

// 探针 run 永远不会被创建：运行时能回答「未找到」即代表连接与配置正常。
// 格式必须符合平台 wrun_+ULID 约定，否则平台 API 直接 400（本地引擎不校验格式，故仅在 Vercel 暴露）
const HEALTH_PROBE_RUN_ID = "wrun_00000000000000000000000000";
const HEALTH_PROBE_TIMEOUT_MS = 5_000;

async function withinProbeTimeout<T>(probe: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("健康探针超时")), HEALTH_PROBE_TIMEOUT_MS);
    probe.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function probeDatabase(): Promise<boolean> {
  try {
    return await withinProbeTimeout(isDatabaseReady());
  } catch (error) {
    console.error("[health-db] 探针失败：", safeErrorForLog(error));
    return false;
  }
}

async function probeWorkflow(): Promise<boolean> {
  try {
    return await withinProbeTimeout(Promise.resolve(getRun(HEALTH_PROBE_RUN_ID).exists).then((exists) => !exists));
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error)) {
      // 平台对不存在的 run 抛「未找到」——确定的否定回答同样是探针通过
      return true;
    }
    console.error("[health-workflow] 探针失败：", safeErrorForLog(error), {
      VERCEL_DEPLOYMENT_ID: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      VERCEL_URL: process.env.VERCEL_URL ?? null,
    });
    return false;
  }
}

export async function GET() {
  const [dbOk, workflowOk] = await Promise.all([probeDatabase(), probeWorkflow()]);
  const ok = dbOk && workflowOk;
  const body = HealthResponse.parse({ ok, db: dbOk, workflow: workflowOk });
  return Response.json(body, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
