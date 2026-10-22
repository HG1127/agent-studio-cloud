function definitionJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}

export function toolDefinitionsEqual(left: unknown, right: unknown): boolean {
  return definitionJson(left) === definitionJson(right);
}
