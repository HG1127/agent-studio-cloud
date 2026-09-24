import { z } from "zod";

// status 原样保留数据库值（当前写入方只有发布动作：production/retired），
// 读路径保持宽容，「当前版本/历史版本」的文案映射由 UI 负责
export const VersionSummary = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type VersionSummary = z.infer<typeof VersionSummary>;

// 成功分支的 exempted 是 M1 演示发布策略的豁免问题标题列表（filterPublishBlockers 产出），
// 由版本面板转成「演示期提醒」展示；空数组表示没有豁免项
export const PublishVersionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), exempted: z.array(z.object({ title: z.string() })) }),
  z.object({ ok: z.literal(false), error: z.string(), issues: z.array(z.string()) }),
]);
export type PublishVersionResult = z.infer<typeof PublishVersionResult>;

export const RestoreVersionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), version: z.number().int().positive() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type RestoreVersionResult = z.infer<typeof RestoreVersionResult>;
