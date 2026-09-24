import { redactSensitiveData } from "@/server/domain/security/redact-sensitive";

const MAX_MEMORY_CHARS = 20_000;

export function buildMemoryContent(args: {
  contentFrom?: string;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): string | null {
  const explicitSource = args.contentFrom?.trim() && args.contentFrom !== "run_summary" ? args.contentFrom.trim() : null;
  const selected = explicitSource
    ? args.outputs[explicitSource]
    : { input: args.input, results: args.outputs };
  if (explicitSource && selected === undefined) return null;
  return JSON.stringify(redactSensitiveData(selected), null, 2).slice(0, MAX_MEMORY_CHARS);
}
