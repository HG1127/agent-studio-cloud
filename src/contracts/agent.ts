import { z } from "zod";
import { WorkflowDraft } from "./workflow";

export const AgentCreateInput = z.object({
  name: z.string().min(1).max(60),
  intentText: z.string().min(10).max(2000),
});
export type AgentCreateInput = z.infer<typeof AgentCreateInput>;

export const AgentUpdateInput = z.object({
  agentId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable(),
});
export type AgentUpdateInput = z.infer<typeof AgentUpdateInput>;

export const AgentUpdateResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type AgentUpdateResult = z.infer<typeof AgentUpdateResult>;

export const AgentSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  versionCount: z.number().int(),
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const AgentArchiveInput = z.object({
  agentId: z.string().uuid(),
  archived: z.boolean(),
});
export type AgentArchiveInput = z.infer<typeof AgentArchiveInput>;

export const AgentArchiveResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type AgentArchiveResult = z.infer<typeof AgentArchiveResult>;

export const AgentTargetOption = z.object({
  agentId: z.string().uuid(),
  agentName: z.string(),
  versionId: z.string().uuid(),
  version: z.number().int().positive(),
  inputContract: z.record(z.string(), z.unknown()),
  outputContract: z.record(z.string(), z.unknown()),
});
export type AgentTargetOption = z.infer<typeof AgentTargetOption>;

export const AgentExportFile = z.object({
  format: z.literal("agent-studio-cloud"),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  agent: z.object({
    name: z.string().min(1).max(60),
    description: z.string().nullable(),
    intentText: z.string().min(1).max(10000),
  }),
  workflow: WorkflowDraft,
});
export type AgentExportFile = z.infer<typeof AgentExportFile>;

export const ImportAgentResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), agentId: z.string().uuid() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ImportAgentResult = z.infer<typeof ImportAgentResult>;

// 创建动作返回的判别联合唯一来源（自 create-agent.ts 迁入）；agentId 由数据库生成
export const CreateAgentResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), agentId: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type CreateAgentResult = z.infer<typeof CreateAgentResult>;
