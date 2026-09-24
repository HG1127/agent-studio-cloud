import { resolvePath } from "@/server/domain/runtime/condition-eval";

export interface LoopCollection {
  items: unknown[];
  sourceCount: number;
  limited: boolean;
}

export function workflowExecutionLimit(nodes: Record<string, { type: string; loop?: { maxIterations?: number } }>): number {
  const nodeCount = Math.max(1, Object.keys(nodes).length);
  const loopBudget = Object.values(nodes)
    .filter((node) => node.type === "loop")
    .reduce((sum, node) => sum + Math.max(1, Math.min(Math.trunc(node.loop?.maxIterations ?? 1), 100)), 0);
  return Math.min(5000, 200 + loopBudget * nodeCount);
}

export function resolveLoopCollection(args: {
  collectionPath: string;
  maxIterations: number;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): LoopCollection {
  const context = { input: args.input, variables: {}, context: { outputs: args.outputs } };
  const resolved = resolvePath(args.collectionPath, context);
  let items: unknown[] | null = Array.isArray(resolved) ? resolved : null;
  if (!items && args.collectionPath.startsWith("context.")) {
    const fallback = resolvePath(`input.${args.collectionPath.slice("context.".length)}`, context);
    items = Array.isArray(fallback) ? fallback : null;
  }
  if (!items) {
    const count = Math.max(0, Math.min(Number(args.input.repeatCount ?? 0), 100));
    items = count > 0 ? Array.from({ length: count }, (_, index) => index + 1) : [];
  }
  const max = Math.max(1, Math.min(Math.trunc(args.maxIterations), 100));
  return {
    items: items.slice(0, max),
    sourceCount: items.length,
    limited: items.length > max,
  };
}
