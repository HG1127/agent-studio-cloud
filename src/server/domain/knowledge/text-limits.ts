export const MAX_KNOWLEDGE_TEXT_CHARS = 2_000_000;

export function validateExtractedKnowledgeText(text: string): string | null {
  if (!text.trim()) return "文件中没有可提取的文字内容";
  if (text.length > MAX_KNOWLEDGE_TEXT_CHARS) {
    return "文件提取后的文字超过 200 万字符，请拆分后重新上传";
  }
  return null;
}
