const PREFERRED_SEARCH_FIELDS = ["question", "query", "input", "task", "brief", "description"] as const;
const MAX_SEARCH_VALUES = 32;
const MAX_SEARCH_VALUE_CHARS = 200;
const MAX_SEARCH_QUERY_CHARS = 1_000;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function searchQueryFromInput(input: Record<string, unknown>): string {
  for (const field of PREFERRED_SEARCH_FIELDS) {
    const preferred = nonEmptyString(input[field]);
    if (preferred) return preferred.slice(0, MAX_SEARCH_QUERY_CHARS);
  }

  const values: string[] = [];
  const seen = new Set<string>();
  const stack: unknown[] = Object.values(input).reverse();
  while (stack.length > 0 && values.length < MAX_SEARCH_VALUES) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push(value[index]);
      continue;
    }
    if (value && typeof value === "object") {
      const children = Object.values(value as Record<string, unknown>);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
      continue;
    }
    const text = nonEmptyString(value) ?? (typeof value === "number" && Number.isFinite(value) ? String(value) : null);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    values.push(text.slice(0, MAX_SEARCH_VALUE_CHARS));
  }
  return values.join(" ").slice(0, MAX_SEARCH_QUERY_CHARS).trim();
}

export function searchQueryFromContext(input: Record<string, unknown>, currentItem?: unknown): string {
  if (currentItem !== undefined && currentItem !== null) {
    const itemInput = typeof currentItem === "string"
      ? { input: currentItem }
      : typeof currentItem === "object" && !Array.isArray(currentItem)
        ? currentItem as Record<string, unknown>
        : { item: currentItem };
    const itemQuery = searchQueryFromInput(itemInput);
    if (itemQuery) return itemQuery;
  }
  return searchQueryFromInput(input);
}
