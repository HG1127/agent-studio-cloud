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
    const page = await pdf.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      const pageText = content.items.flatMap((item) => {
        if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string") return [];
        return [`${item.str}${"hasEOL" in item && item.hasEOL ? "\n" : ""}`];
      }).join("");
      totalChars += pageText.length + (pages.length > 0 ? 1 : 0);
      if (totalChars > MAX_KNOWLEDGE_TEXT_CHARS) throw new KnowledgePdfLimitError();
      pages.push(pageText);
    } finally {
      await Promise.resolve(page.cleanup?.()).catch(() => undefined);
    }
  }
  return pages.join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
