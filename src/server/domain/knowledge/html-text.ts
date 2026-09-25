const HIDDEN_HTML_BLOCKS = /<(script|style|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENTS = /<!--[\s\S]*?-->/g;
const BLOCK_BOUNDARIES = /<\/?(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi;
const HTML_TAGS = /<[^>]*>/g;
const HTML_ENTITIES = /&(?:#([0-9]{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi;

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  copy: "©",
  emsp: " ",
  ensp: " ",
  gt: ">",
  hellip: "…",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  reg: "®",
  trade: "™",
};

function decodeEntity(entity: string, decimal?: string, hexadecimal?: string, named?: string): string {
  if (named) return namedEntities[named.toLowerCase()] ?? entity;
  const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", hexadecimal ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}

export function extractHtmlText(html: string): string {
  return html
    .replace(HTML_COMMENTS, " ")
    .replace(HIDDEN_HTML_BLOCKS, " ")
    .replace(BLOCK_BOUNDARIES, "\n")
    .replace(HTML_TAGS, " ")
    .replace(HTML_ENTITIES, decodeEntity)
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
