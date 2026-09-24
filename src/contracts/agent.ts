import { z } from "zod";

export const AgentCreateInput = z.object({
  name: z.string().min(1).max(60),
  intentText: z.string().min(10).max(2000),
});
export type AgentCreateInput = z.infer<typeof AgentCreateInput>;

export const AgentSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  versionCount: z.number().int(),
  updatedAt: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const AgentTargetOption = z.object({
  agentId: z.string().uuid(),
  agentName: z.string(),
  versionId: z.string().uuid(),
  version: z.number().int().positive(),
  inputContract: z.record(z.string(), z.unknown()),
  outputContract: z.record(z.string(), z.unknown()),
});
export type AgentTargetOption = z.infer<typeof AgentTargetOption>;

// 创建动作返回的判别联合唯一来源（自 create-agent.ts 迁入）；agentId 由数据库生成
export const CreateAgentResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), agentId: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type CreateAgentResult = z.infer<typeof CreateAgentResult>;
