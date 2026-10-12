import { z } from "zod";

export const MAX_ACCEPTANCE_POOLS = 128;
const PoolId = z.uuid().transform((value) => value.toLowerCase());
const PoolIds = z.array(PoolId).max(MAX_ACCEPTANCE_POOLS);

export const AcceptancePoolCloseReceipt = z.object({
  ownerId: PoolId,
  state: z.enum(["open", "closing", "callbacks_completed", "callback_failed"]),
  poolIds: PoolIds,
  completedIds: PoolIds,
  failedIds: PoolIds,
  unknownIds: PoolIds,
  cleanupPermitted: z.literal(false),
}).strict().superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  for (const ids of [value.poolIds, value.completedIds, value.failedIds, value.unknownIds]) {
    if (new Set(ids).size !== ids.length) issue("连接标识列表不能重复");
  }
  const registered = new Set(value.poolIds);
  const classified = [...value.completedIds, ...value.failedIds, ...value.unknownIds];
  if (classified.some((id) => !registered.has(id))) issue("关闭回执只能包含已登记连接");
  if (new Set(classified).size !== classified.length) issue("关闭完成、失败和未知列表不能交叉");
  if (classified.length !== value.poolIds.length) issue("每个登记连接必须明确归入完成、失败或未知");
  if (value.state === "open" && (value.completedIds.length > 0 || value.failedIds.length > 0)) issue("尚未封闭时不能登记关闭回调结果");
  if (value.state === "callbacks_completed" && (value.failedIds.length > 0 || value.unknownIds.length > 0)) issue("关闭回调全部完成不能仍有失败或未知连接");
  if (value.state === "callback_failed" && value.failedIds.length === 0 && value.unknownIds.length === 0) issue("关闭回调失败必须保留失败或未知连接");
});
export type AcceptancePoolCloseReceipt = z.infer<typeof AcceptancePoolCloseReceipt>;
