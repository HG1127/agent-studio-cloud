import type { WorkflowNode } from "@/contracts/workflow";
import { KnowledgeQuery } from "@/contracts/knowledge";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { redactCredentialText, redactStructuredCredentialData } from "@/server/domain/security/redact-sensitive";
import { resolveNodeInput } from "./input-mapping";
import { searchQueryFromContext, searchQueryFromInput } from "./search-query";

export function resolveKnowledgeQuery(args: {
  node: Pick<WorkflowNode, "title" | "knowledge" | "inputMapping">;
  input: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  currentItem?: unknown;
}): { ok: true; query: string } | { ok: false; error: string } {
  if (!args.node.inputMapping) {
    return { ok: true, query: (args.node.knowledge?.query?.trim() || searchQueryFromContext(args.input, args.currentItem)).trim() };
  }
  if (args.node.inputMapping.includeUpstreamOutputs) {
    return { ok: false, error: `步骤「${args.node.title}」请只映射检索需要的字段，不能附带全部成果` };
  }
  const mapped = resolveNodeInput({ node: args.node, input: args.input, outputs: args.outputs ?? {} });
  if (!mapped.ok) return { ok: false, error: redactCredentialText(mapped.error) };
  if (!jsonValuesEqual(mapped.input, redactStructuredCredentialData(mapped.input))) {
    return { ok: false, error: `步骤「${args.node.title}」的检索字段包含凭据，请移除后重试` };
  }
  if (Object.hasOwn(mapped.input, "query")) {
    const query = KnowledgeQuery.safeParse(mapped.input.query);
    return query.success ? { ok: true, query: query.data }
      : { ok: false, error: `步骤「${args.node.title}」的检索词无效，请提供不超过 1000 个字符的非空文字或有限数字` };
  }
  const query = searchQueryFromInput(mapped.input).trim();
  return query ? { ok: true, query }
    : { ok: false, error: `步骤「${args.node.title}」映射后的检索内容为空，请映射业务问题或主题` };
}
