import { safeDataPathSegments } from "@/server/domain/runtime/data-path";

// 条件求值纯函数：路径解析与比较算子。只做纯计算，供 condition-step 消费与单测。
export interface RunEvalContext {
  input: Record<string, unknown>;
  variables: Record<string, unknown>;
  context: { outputs: Record<string, unknown>; currentItem?: unknown };
}

export function runEvalContext(args: {
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
  currentItem?: unknown;
}): RunEvalContext {
  return {
    input: args.input,
    variables: args.input,
    context: { outputs: args.outputs, currentItem: args.currentItem },
  };
}

const ROOTS: ReadonlySet<string> = new Set(["input", "variables", "context"]);

// 支持 input.x / variables.x / context.outputs.<nodeId> / context.currentItem.x 及嵌套段；未知路径返回 undefined
export function resolvePath(path: string, ctx: RunEvalContext): unknown {
  const segments = safeDataPathSegments(path);
  if (!segments || !ROOTS.has(segments[0])) return undefined;
  let current: unknown = ctx[segments[0] as keyof RunEvalContext];
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

// eq/neq/contains/gt/gte/lt/lte/truthy/exists；未知 operator 一律返回 false（不猜不误判）
export function compare(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== undefined && actual !== null && actual !== expected;
    case "contains":
      if (expected === undefined || expected === null || (typeof expected === "string" && !expected.trim())) return false;
      if (typeof actual === "string") return actual.includes(String(expected ?? ""));
      if (Array.isArray(actual)) return actual.some((item) => item === expected);
      return false;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (actual === undefined || actual === null || expected === undefined || expected === null) return false;
      if ((typeof actual === "string" && !actual.trim()) || (typeof expected === "string" && !expected.trim())) return false;
      const left = Number(actual);
      const right = Number(expected);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      if (operator === "gt") return left > right;
      if (operator === "gte") return left >= right;
      if (operator === "lt") return left < right;
      return left <= right;
    }
    case "truthy":
      return Boolean(actual);
    case "exists":
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

export function matchConditionRules(
  rules: Array<{ source: string; operator: string; value?: unknown }>,
  mode: "all" | "any" | undefined,
  ctx: RunEvalContext,
): boolean {
  if (rules.length === 0) return false;
  const matches = (rule: { source: string; operator: string; value?: unknown }) =>
    compare(resolvePath(rule.source, ctx), rule.operator, rule.value);
  return mode === "any" ? rules.some(matches) : rules.every(matches);
}
