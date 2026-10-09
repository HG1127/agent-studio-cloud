"use server";

import { z } from "zod";
import { AgentExportFile, type ImportAgentResult } from "@/contracts/agent";
import { MvpTemplateInput } from "@/contracts/mvp-template";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { listToolRegistryOptions } from "@/server/tools/tool-registry";
import { importAgentAction } from "@/server/actions/import-agent";

export async function createMvpAgentAction(input: unknown, requestId: string): Promise<ImportAgentResult> {
  const parsed = MvpTemplateInput.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(requestId).success) {
    return { ok: false, error: "模板参数或创建请求不完整，请检查后重新提交" };
  }
  const built = buildMvpTemplate(parsed.data, listToolRegistryOptions());
  if (!built.ok) return built;
  const exported = AgentExportFile.safeParse({
    format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(),
    agent: { name: parsed.data.name, description: parsed.data.businessGoal.slice(0, 200), intentText: built.intentText },
    workflow: built.draft,
  });
  if (!exported.success) return { ok: false, error: "业务描述超过保存限制，请精简目标和规则" };
  return importAgentAction(exported.data, requestId);
}
