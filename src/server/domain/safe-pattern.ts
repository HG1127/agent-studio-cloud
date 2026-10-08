export const MAX_PATTERN_LENGTH = 200;
export const MAX_PATTERN_INPUT_LENGTH = 4096;

type Atom = { kind: "atom"; matcher: RegExp; minimum: number; maximum: number };
type Assertion = { kind: "start" | "end" | "boundary" | "non-boundary" };
export type SafePattern = readonly (Atom | Assertion)[];

function atom(source: string, minimum = 1, maximum = 1): Atom {
  return { kind: "atom", matcher: new RegExp("^(?:" + source + ")$"), minimum, maximum };
}

function escapeEnd(pattern: string, index: number): number {
  const character = pattern[index + 1];
  if (character === "u" && /^[0-9a-f]{4}$/i.test(pattern.slice(index + 2, index + 6))) return index + 6;
  if (character === "x" && /^[0-9a-f]{2}$/i.test(pattern.slice(index + 2, index + 4))) return index + 4;
  if (character === "c" && /^[a-z]$/i.test(pattern[index + 2] ?? "")) return index + 3;
  if (character === "0") {
    let end = index + 2;
    while (end < index + 4 && /^[0-7]$/.test(pattern[end] ?? "")) end += 1;
    return end;
  }
  return index + 2;
}

export function compileSafePattern(pattern: string): SafePattern | null {
  if (pattern.length > MAX_PATTERN_LENGTH) return null;
  try { new RegExp(pattern); } catch { return null; }
  if (/[()|]/.test(pattern.replace(/\\./g, "")) || /\\[1-9]/.test(pattern)) return null;
  const tokens: Array<Atom | Assertion> = [];
  for (let index = 0; index < pattern.length;) {
    const character = pattern[index];
    if (character === "^" || character === "$") {
      tokens.push({ kind: character === "^" ? "start" : "end" });
      index += 1;
      continue;
    }
    if (character === "\\" && (pattern[index + 1] === "b" || pattern[index + 1] === "B")) {
      tokens.push({ kind: pattern[index + 1] === "b" ? "boundary" : "non-boundary" });
      index += 2;
      continue;
    }
    let end = index + 1;
    let source = character;
    if (character === "[") {
      while (end < pattern.length) {
        if (pattern[end] === "\\") { end += 2; continue; }
        if (pattern[end++] === "]") break;
      }
      source = pattern.slice(index, end);
    } else if (character === "\\") {
      end = escapeEnd(pattern, index);
      if (pattern[index + 1] === "c" && end === index + 2) {
        // 非 Unicode 模式下无效控制转义保留反斜线，数量规则仅作用于后面的 c。
        tokens.push(atom("\\\\"));
        source = "c";
      } else {
        source = pattern.slice(index, end);
      }
    } else if ("*+?()|".includes(character)) {
      return null;
    }
    let minimum = 1;
    let maximum = 1;
    const quantity = pattern[end];
    if (quantity === "*" || quantity === "+" || quantity === "?") {
      minimum = quantity === "+" ? 1 : 0;
      maximum = quantity === "?" ? 1 : Infinity;
      end += 1;
      if (pattern[end] === "?") end += 1;
    } else {
      const range = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(end));
      if (range) {
        minimum = Number(range[1]);
        maximum = range[2] === undefined ? minimum : range[2] === "" ? Infinity : Number(range[2]);
        end += range[0].length;
        if (pattern[end] === "?") end += 1;
      }
    }
    tokens.push(atom(source, minimum, maximum));
    index = end;
  }
  return tokens;
}

function isWordCharacter(value: string, index: number): boolean {
  const code = value.charCodeAt(index);
  return code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95;
}

export function safePatternMatches(value: string, tokens: SafePattern): boolean {
  const length = value.length;
  if (length > MAX_PATTERN_INPUT_LENGTH * 2) return false;
  let current = new Uint8Array(length + 1).fill(1);
  let next = new Uint8Array(length + 1);
  const prefix = new Int32Array(length + 2);
  for (const token of tokens) {
    if (token.kind !== "atom") {
      for (let index = 0; index <= length; index += 1) {
        if (!current[index]) continue;
        const boundary = isWordCharacter(value, index - 1) !== isWordCharacter(value, index);
        const accepted = token.kind === "start" ? index === 0
          : token.kind === "end" ? index === length
          : token.kind === "boundary" ? boundary : !boundary;
        if (!accepted) current[index] = 0;
      }
      continue;
    }
    if (token.minimum > length) return false;
    if (token.maximum === 0) continue;
    prefix[0] = 0;
    for (let index = 0; index <= length; index += 1) prefix[index + 1] = prefix[index] + current[index];
    if (prefix[length + 1] === 0) return false;
    next.fill(0);
    const maximum = Math.min(token.maximum, length);
    let runStart = 0;
    // 前缀和一次合并所有可行起点，不逐个展开数量范围，也不回溯整段消息。
    for (let end = 0; end <= length; end += 1) {
      if (end > 0 && !token.matcher.test(value.charAt(end - 1))) runStart = end;
      const lower = Math.max(runStart, end - maximum);
      const upper = end - token.minimum;
      if (upper >= lower && prefix[upper + 1] > prefix[lower]) next[end] = 1;
    }
    const previous = current;
    current = next;
    next = previous;
  }
  return current.some((position) => position !== 0);
}
