function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, 220) : null;
}

export function memoryPreview(content: string): string {
  const fallback = content.trim().replace(/\s+/g, " ").slice(0, 220);
  if (!fallback) return "这条经验没有可预览的文字，请查看完整保存内容。";
  try {
    const parsed: unknown = JSON.parse(content);
    const root = asRecord(parsed);
    if (!root) return readableText(parsed) ?? fallback;
    for (const key of ["summary", "task", "answer", "text", "content"]) {
      const text = readableText(root[key]);
      if (text) return text;
    }
    const results = asRecord(root.results);
    if (results) {
      for (const value of Object.values(results)) {
        const direct = readableText(value);
        if (direct) return direct;
        const nested = asRecord(value);
        if (nested) {
          for (const key of ["summary", "answer", "text", "content"]) {
            const text = readableText(nested[key]);
            if (text) return text;
          }
        }
      }
    }
    const inputCount = Object.keys(asRecord(root.input) ?? {}).length;
    const resultCount = Object.keys(results ?? {}).length;
    if (inputCount || resultCount) return `保存了 ${inputCount} 项任务输入和 ${resultCount} 项处理结果，展开可查看完整内容。`;
    return `保存了 ${Object.keys(root).length} 项内容，展开可查看完整内容。`;
  } catch {
    return fallback;
  }
}
