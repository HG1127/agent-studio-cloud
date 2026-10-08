import { KNOWLEDGE_TEXT_LIMIT_ERROR, MAX_KNOWLEDGE_TEXT_CHARS } from "@/server/domain/knowledge/text-limits";

export interface PdfTextDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: unknown[] }>;
    cleanup?: () => unknown;
  }>;
}

export class KnowledgePdfLimitError extends Error {
  constructor() {
    super(KNOWLEDGE_TEXT_LIMIT_ERROR);
    this.name = "KnowledgePdfLimitError";
  }
}

export async function extractBoundedPdfText(pdf: PdfTextDocument): Promise<string> {
  const pages: string[] = [];
  let totalChars = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    totalChars += pages.length > 0 ? 1 : 0;
    if (totalChars > MAX_KNOWLEDGE_TEXT_CHARS) throw new KnowledgePdfLimitError();
    const page = await pdf.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      const fragments: string[] = [];
      for (const item of content.items) {
        if (!item || typeof item !== "object" || !("str" in item)) continue;
        const text = item.str;
        if (typeof text !== "string") continue;
        const hasEOL = "hasEOL" in item && Boolean(item.hasEOL);
        totalChars += text.length + (hasEOL ? 1 : 0);
        if (totalChars > MAX_KNOWLEDGE_TEXT_CHARS) throw new KnowledgePdfLimitError();
        if (text) fragments.push(text);
        if (hasEOL) fragments.push("\n");
      }
      pages.push(fragments.join(""));
    } finally {
      await Promise.resolve().then(() => page.cleanup?.()).catch(() => undefined);
    }
  }
  return pages.join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
