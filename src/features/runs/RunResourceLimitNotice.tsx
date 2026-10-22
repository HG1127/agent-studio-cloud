import Link from "next/link";
import { ExecutionResourceLimit, type ExecutionResourceLimit as ResourceLimit } from "@/contracts/execution-resources";

const labels = {
  "concurrent-chains": "执行链数量",
  "model-calls": "模型调用次数",
  "child-runs": "协作任务数量",
} satisfies Record<ResourceLimit["kind"], string>;

export function RunResourceLimitNotice({ resourceLimit }: { resourceLimit: unknown }) {
  const parsed = ExecutionResourceLimit.safeParse(resourceLimit);
  if (!parsed.success) return null;
  const limit = parsed.data;

  return <div aria-label="本次资源限额回复" className="mt-3 space-y-1 border-t border-current/20 pt-3">
    <p className="font-semibold">本次回复：{labels[limit.kind]}达到上限</p>
    <p>本次回复中的已用数量 {limit.current} · 上限 {limit.maximum}</p>
    <p className="text-xs leading-5">仅反映这次启动回复；不是当前全局实时余量、历史额度或费用，也不能据此判断上次待核对的请求是否已创建任务。</p>
    <Link href="/harness#execution-resources" prefetch={false} className="inline-block font-semibold underline underline-offset-2">手动查看资源设置</Link>
  </div>;
}
