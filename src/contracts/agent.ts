import { z } from "zod";
import { AgentInputContract } from "./manifest";
import { WorkflowDraft } from "./workflow";
import { VersionExportFile } from "./version";

export const AgentCreateInput = z.object({
  name: z.string().trim().min(1).max(60),
  intentText: z.string().trim().min(10).max(2000),
});
export type AgentCreateInput = z.infer<typeof AgentCreateInput>;

export const AgentUpdateInput = z.object({
  agentId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable(),
  expectedUpdatedAt: z.iso.datetime(),
});
export type AgentUpdateInput = z.infer<typeof AgentUpdateInput>;

export const AgentUpdateResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), updatedAt: z.iso.datetime() }),
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

export const AgentDetailView = z.object({
  agent: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    intentText: z.string(),
    updatedAt: z.date(),
  }),
  draft: WorkflowDraft.nullable(),
  draftUpdatedAt: z.string().nullable(),
  currentVersion: z.object({
    id: z.string().uuid(),
    manifest: z.unknown(),
  }).nullable(),
});
export type AgentDetailView = z.infer<typeof AgentDetailView>;

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
  inputContract: AgentInputContract,
  outputContract: WorkflowDraft.shape.outputContract.unwrap(),
});
export type AgentTargetOption = z.infer<typeof AgentTargetOption>;

export const AgentExportFile = z.object({
  format: z.literal("agent-studio-cloud"),
  formatVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  agent: z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).nullable(),
    intentText: z.string().trim().min(10).max(2000),
  }),
  workflow: WorkflowDraft,
});
export type AgentExportFile = z.infer<typeof AgentExportFile>;

export const AgentImportFile = z.union([AgentExportFile, VersionExportFile]);
export type AgentImportFile = z.infer<typeof AgentImportFile>;

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
