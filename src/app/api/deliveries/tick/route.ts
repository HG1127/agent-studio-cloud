import { RunDeliveryTickResult } from "@/contracts/run-delivery";
import { dispatchRunDeliveriesAction } from "@/server/actions/dispatch-run-deliveries";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export const dynamic = "force-dynamic";
async function handle(request: Request) {
  const noStore = { "cache-control": "no-store" };
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, error: "未授权的调用" }, { status: 401, headers: noStore });
  try {
    const result = RunDeliveryTickResult.parse(await dispatchRunDeliveriesAction(request.headers.get("authorization")));
    return Response.json(result, { status: result.ok ? 200 : 503, headers: { ...noStore, ...(!result.ok ? { "retry-after": "60" } : {}) } });
  } catch (error) {
    console.error("投递调度结果待确认", safeErrorForLog(error));
    return Response.json({ ok: false, error: "投递检查暂时失败，请稍后重试", retryable: true }, { status: 503, headers: { ...noStore, "retry-after": "60" } });
  }
}
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
