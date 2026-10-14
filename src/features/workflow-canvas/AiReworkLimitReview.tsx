import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES, WorkflowNode } from "@/contracts/workflow";

export function AiReworkLimitReview({ originalNode, inline = false, source = "saved" }: { originalNode: unknown; inline?: boolean; source?: "saved" | "draft" }) {
  if (!isPassiveJsonData(originalNode, MAX_WORKFLOW_BYTES) || !originalNode || typeof originalNode !== "object" || Array.isArray(originalNode)) return <p className="text-xs leading-5 text-amber-900">尝试设置无法安全核对，保持只读，不补造次数。</p>;
  const raw = originalNode as Record<string, unknown>;
  const hasRetry = Object.hasOwn(raw, "retry");
  const retry = hasRetry && raw.retry && typeof raw.retry === "object" && !Array.isArray(raw.retry) ? raw.retry as Record<string, unknown> : null;
  const parsed = WorkflowNode.safeParse({ ...raw, id: typeof raw.id === "string" ? raw.id : "readonly", title: typeof raw.title === "string" ? raw.title : "已保存步骤" });
  const value = parsed.success && hasRetry ? parsed.data.retry : undefined;
  return <section aria-label="智能处理返工设置只读核对" className="space-y-2 rounded-lg border border-slate-200 p-3">
    <h4 className="text-sm font-semibold text-slate-900">智能处理返工设置只读核对</h4>
    {source === "draft" ? <p className="text-xs leading-5 text-slate-500">仅核对当前画布设置，不代表已保存或已发布。</p> : null}
    {!hasRetry ? <p className="text-xs leading-5 text-slate-600">{source === "saved" ? "原步骤未保存" : "当前步骤没有"}尝试设置，不补写默认参数。{!inline && raw.type === "ai" ? "当前执行器对缺失必需结果的顶层智能处理默认最多额外返工一次；该默认没有写入此设置。" : ""}</p> : value && raw.type === "ai" ? <p className="text-xs leading-5 text-slate-700">{source === "saved" ? "原保存" : "当前"}总尝试上限：{value.maxAttempts} 次，包含首次处理；{inline ? "当前不用于组内质量返工。" : `最多额外返工 ${value.maxAttempts - 1} 次。`}原等待参数：{value.backoffMs} 毫秒；当前质量返工不按此参数等待。</p> : <p className="text-xs leading-5 text-amber-900">原尝试设置无法完整校验或不适用于智能处理，保持原样，不推测次数或实际行为。</p>}
    {retry && Object.keys(retry).some((key) => key !== "maxAttempts" && key !== "backoffMs") ? <p className="text-xs leading-5 text-slate-500">原尝试设置含额外字段，仅保留原定义，不解释或删除。</p> : null}
    {inline ? <p className="text-xs leading-5 text-amber-900">当前质量检查不会自动返工组内步骤。以上仅为原配置，不代表组内返工会生效；没有修改或运行入口。</p> : <p className="text-xs leading-5 text-slate-500">仅针对指定必需结果缺失的顶层智能处理，不等同于网络重试，也不证明已经返工或获批准。</p>}
  </section>;
}
