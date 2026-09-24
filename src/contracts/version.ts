import { z } from "zod";
import { AgentManifest } from "./manifest";

// status 原样保留数据库值（发布动作写入 candidate/production/retired/superseded），
// 读路径保持宽容，「当前版本/历史版本」的文案映射由 UI 负责
export const VersionSummary = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
});
export type VersionSummary = z.infer<typeof VersionSummary>;

// 成功分支的 exempted 是控制面审计误报的豁免问题标题列表（filterPublishBlockers 产出）；
// 由版本面板转成控制面提醒展示，空数组表示没有豁免项。
export const PublishVersionResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    release: z.enum(["candidate", "production"]),
    exempted: z.array(z.object({ title: z.string() })),
    version: VersionSummary,
  }),
  z.object({ ok: z.literal(false), error: z.string(), issues: z.array(z.string()) }),
]);
export type PublishVersionResult = z.infer<typeof PublishVersionResult>;

export const RestoreVersionResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), version: VersionSummary }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type RestoreVersionResult = z.infer<typeof RestoreVersionResult>;

export const VersionExportFile = z.object({
  format: z.literal("agent-studio-cloud-version"),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  agent: z.object({ name: z.string() }),
  version: z.object({ number: z.number().int().positive(), status: z.string(), createdAt: z.iso.datetime() }),
  manifest: AgentManifest,
});
export type VersionExportFile = z.infer<typeof VersionExportFile>;
