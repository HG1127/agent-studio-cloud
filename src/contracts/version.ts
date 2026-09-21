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

export const PublishVersionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string(), issues: z.array(z.string()) }),
]);
export type PublishVersionResult = z.infer<typeof PublishVersionResult>;
