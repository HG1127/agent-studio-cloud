import { resolveLocalSchemaReference } from "./json-schema-reference";

type Rule = Record<string, unknown>;
type Scope = { rules: Rule[]; writeOnly: boolean; children: Map<string | null | undefined, Scope> };
const COMBINATIONS = ["allOf", "anyOf", "oneOf"];
const LITERALS = ["default", "const", "enum", "examples"];

// 调用方先验证被动 JSON 与受支持契约；本检查只限制公开固定文字，不处理运行数据。
export function writeOnlySchemaLiteralsAreSafe(root: Rule): boolean {
  let remaining = 8 * 1024 * 1024;
  let nextId = 0, memoEntries = 0;
  const ids = new WeakMap<object, number>(), scopes = new Map<string, Scope>();
  const seenValues = new WeakMap<Scope, Set<unknown>>(), textValues = new WeakMap<object, boolean>();
  const unsafe = Symbol();
  function spend(work = 1) { if ((remaining -= work) < 0) throw unsafe; }
  function expand(roots: unknown[]): Scope {
    const pending = [...roots], rules = new Set<Rule>();
    while (pending.length) {
      spend();
      const value = pending.pop();
      if (!value || typeof value !== "object" || Array.isArray(value) || rules.has(value as Rule)) continue;
      const rule = value as Rule; rules.add(rule);
      if (Object.hasOwn(rule, "$ref")) {
        const target = resolveLocalSchemaReference(root, rule.$ref);
        if (!target.ok) throw unsafe;
        pending.push(target.schema);
      }
      for (const keyword of COMBINATIONS) {
        const branches = rule[keyword];
        if (Array.isArray(branches)) pending.push(...branches);
      }
      if (pending.length > 50_000) throw unsafe;
    }
    const keys = [...rules].map((rule) => {
      if (!ids.has(rule)) ids.set(rule, nextId++);
      return ids.get(rule)!;
    });
    spend(keys.length * (1 + Math.ceil(Math.log2(keys.length + 1))));
    const key = keys.sort((left, right) => left - right).join(",");
    const cached = scopes.get(key);
    if (cached) return cached;
    const scope: Scope = { rules: [...rules], writeOnly: [...rules].some((rule) => rule.writeOnly === true), children: new Map() };
    if (scopes.size >= 50_000) throw unsafe;
    scopes.set(key, scope); return scope;
  }
  function child(scope: Scope, key: string | null | undefined): Scope {
    const cached = scope.children.get(key);
    if (cached) return cached;
    const roots = scope.rules.map((rule) => {
      spend();
      if (key === null) return rule.items;
      if (key === undefined) return rule.additionalProperties;
      const properties = rule.properties as Rule | undefined;
      return properties && Object.hasOwn(properties, key) ? properties[key] : rule.additionalProperties;
    });
    const result = expand(roots); scope.children.set(key, result); return result;
  }
  function containsText(value: unknown): boolean {
    spend();
    if (typeof value === "string") return value.length > 0;
    if (!value || typeof value !== "object") return false;
    const cached = textValues.get(value);
    if (cached !== undefined) return cached;
    const values = Object.values(value); spend(values.length);
    const result = values.some(containsText); textValues.set(value, result); return result;
  }
  function inspectLiteral(value: unknown, scope: Scope, sensitive: boolean): boolean {
    const pending = [{ value, scope }];
    while (pending.length) {
      spend();
      const current = pending.pop()!;
      if (sensitive || current.scope.writeOnly) {
        if (containsText(current.value)) return false;
        continue;
      }
      if (!current.scope.rules.length) continue;
      const seen = seenValues.get(current.scope) ?? new Set<unknown>();
      if (seen.has(current.value)) continue;
      if (++memoEntries > 50_000) throw unsafe;
      seen.add(current.value); seenValues.set(current.scope, seen);
      if (Array.isArray(current.value)) {
        const items = child(current.scope, null);
        for (const item of current.value) pending.push({ value: item, scope: items });
      } else if (current.value && typeof current.value === "object") {
        for (const [key, item] of Object.entries(current.value)) pending.push({ value: item, scope: child(current.scope, key) });
      }
      if (pending.length > 50_000) throw unsafe;
    }
    return true;
  }
  try {
    const pending = [{ scope: expand([root]), sensitive: false }], visited = new WeakMap<Scope, number>();
    while (pending.length) {
      spend();
      const current = pending.pop()!, sensitive = current.sensitive || current.scope.writeOnly;
      const mode = sensitive ? 2 : 1, previous = visited.get(current.scope) ?? 0;
      if (!current.scope.rules.length || previous & mode) continue;
      visited.set(current.scope, previous | mode);
      const fields = new Set<string>();
      for (const rule of current.scope.rules) {
        spend();
        for (const keyword of LITERALS) if (Object.hasOwn(rule, keyword)) {
          const value = rule[keyword], candidates = (keyword === "enum" || keyword === "examples") && Array.isArray(value) ? value : [value];
          for (const candidate of candidates) if (!inspectLiteral(candidate, current.scope, sensitive)) return false;
        }
        for (const key of Object.keys((rule.properties as Rule | undefined) ?? {})) { spend(); fields.add(key); }
        for (const keyword of ["$defs", "definitions"]) {
          for (const definition of Object.values((rule[keyword] as Rule | undefined) ?? {})) pending.push({ scope: expand([definition]), sensitive });
        }
        if (rule.not !== undefined) pending.push({ scope: expand([rule.not]), sensitive });
      }
      for (const field of fields) pending.push({ scope: child(current.scope, field), sensitive });
      pending.push({ scope: child(current.scope, null), sensitive }, { scope: child(current.scope, undefined), sensitive });
      if (pending.length > 50_000) throw unsafe;
    }
    return true;
  } catch { return false; }
}
