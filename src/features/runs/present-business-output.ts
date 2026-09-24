export interface PresentedBusinessOutput {
  text: string;
  reviewable: boolean;
}

const BODY_FIELDS = [
  "reply_suggestion", "suggested_reply", "draft_reply", "reply", "response",
  "final_answer", "answer", "content", "text", "summary", "result",
];

function removeThinking(raw: string): string | null {
  const cleaned = raw.replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "").trim();
  return /<\/?think\b/i.test(cleaned) ? null : cleaned;
}

export function presentBusinessOutput(raw: string): PresentedBusinessOutput {
  const withoutThinking = removeThinking(raw);
  if (withoutThinking === null) {
    return { text: "模型结果包含未结束的思考内容，请核对步骤数据后重试。", reviewable: false };
  }

  const fenced = withoutThinking.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const content = (fenced?.[1] ?? withoutThinking).trim();
  if (!content) {
    return { text: "这一步没有生成可审阅的正文，请核对步骤数据后重试。", reviewable: false };
  }

  const looksStructured = content.startsWith("{") || /^\[\s*(?:\{|\[|"|-?\d|true|false|null|\])/.test(content);
  if (looksStructured) {
    try {
      const parsed: unknown = JSON.parse(content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const fields = parsed as Record<string, unknown>;
        for (const field of BODY_FIELDS) {
          const value = fields[field];
          if (typeof value === "string") {
            const body = removeThinking(value);
            if (body) return { text: body, reviewable: true };
          }
        }
      }
    } catch {
      // Incomplete structured output has no safe business-facing representation.
    }
    return { text: "模型返回了结构化数据，请在步骤数据中核对后重试。", reviewable: false };
  }

  return { text: content, reviewable: true };
}
