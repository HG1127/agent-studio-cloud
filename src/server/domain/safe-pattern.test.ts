import { afterEach, describe, expect, it, vi } from "vitest";
import { compileSafePattern, safePatternMatches, MAX_PATTERN_INPUT_LENGTH } from "./safe-pattern";

afterEach(() => vi.restoreAllMocks());

const samples = [
  "", "a", "aa", "ab", "aba", "bbb", "A12", "order 12", "word", "sword", "word!",
  "a\n", "\n", "\r\n", "\t", "\u0000", "\u0001", "\u0008", "\u0011", "\u00008", "\n3", "\\c", "\\ccc",
  "u", "uu", "x", "a{2,3", "{12}", "]]?+", "😀", "\ud83d", "\ude00", "😀😀",
];

describe("有界消息格式匹配", () => {
  it.each([
    "", "^$", "^a$", "a$", "a*", "^a+?b?$", "^a{02,2}b{1,01}$",
    "^a{0,3}a{1,2}$", "a{2,3", "\\c", "\\c+", "\\u", "\\u{2,3}", "\\x",
    "\\0123", "\\08", "^\\cA$", "^\\u0061+$", "^\\x61+$", "^\\a+$",
    "^\\++\\?{2}$", "^\\{[0-9]+\\}$", "^[\\]]+[?*+]{2}$",
    "^\\w+\\s+\\d+$", "\\bword\\b", "\\Bword\\B", "\\b", "\\B",
    "^[^]+$", "^[a-z]+[0-9]+$", "^.*?a.*?$", "^😀+$", "^[😀]+$",
    "^\\ud83d\\ude00+$", "^[\\b\\c1]+$",
  ])("与原生布尔语义一致：%s", (pattern) => {
    const compiled = compileSafePattern(pattern);
    expect(compiled).not.toBeNull();
    const native = new RegExp(pattern);
    for (const value of samples) {
      expect(safePatternMatches(value, compiled!), pattern + " / " + JSON.stringify(value)).toBe(native.test(value));
    }
  });

  it("穷举短消息的双原子和数量规则，与原生匹配交叉验证", () => {
    const atoms = ["a", "[ab]", "[^a]", "\\d", ".", "\\u0061", "\\012"];
    const quantities = ["", "?", "*", "+", "{2}", "{1,2}"];
    for (const first of atoms) for (const second of atoms) {
      for (const firstQuantity of quantities) for (const secondQuantity of quantities) {
        const pattern = "^" + first + firstQuantity + second + secondQuantity + "$";
        const compiled = compileSafePattern(pattern);
        expect(compiled).not.toBeNull();
        const native = new RegExp(pattern);
        for (const value of samples) {
          expect(safePatternMatches(value, compiled!), pattern + " / " + JSON.stringify(value)).toBe(native.test(value));
        }
      }
    }
  }, 30_000);

  it("长消息的多处重复只交给原生匹配器单字符，调用次数按规则数乘文字长度有界", () => {
    const compiled = compileSafePattern("^a+a+a+a+a+a+b$")!;
    const originalTest = RegExp.prototype.test;
    const nativeTest = vi.spyOn(RegExp.prototype, "test").mockImplementation(function (this: RegExp, value: string) {
      if (typeof value !== "string" || value.length > 1) throw new Error("原生匹配器不得处理整段消息");
      return originalTest.call(this, value);
    });
    const value = "a".repeat(MAX_PATTERN_INPUT_LENGTH);
    const matches = safePatternMatches(value, compiled);
    const count = nativeTest.mock.calls.length;
    nativeTest.mockRestore();
    expect(matches).toBe(false);
    expect(count).toBe(7 * value.length);
    expect(safePatternMatches(value.slice(1) + "b", compiled)).toBe(true);
  });

  it("巨大数量上限不展开匹配状态，无法达到的下限直接失败", () => {
    const repeated = compileSafePattern("^a{0,999999999999999999999999}a{0,999999999999999999999999}b$")!;
    const unreachable = compileSafePattern("^a{999999999999999999999999}$")!;
    expect(safePatternMatches("aaab", repeated)).toBe(true);
    expect(safePatternMatches("aaac", repeated)).toBe(false);
    expect(safePatternMatches("aaa", unreachable)).toBe(false);
  });

  it.each(["[", "a{2,1}", "(a+)+", "a|b", "\\1", "a".repeat(201)])("拒绝无效或范围外语法：%s", (pattern) => {
    expect(compileSafePattern(pattern)).toBeNull();
  });

  it("字符串容量仍受字段契约的上限约束", () => {
    expect(safePatternMatches("a".repeat(MAX_PATTERN_INPUT_LENGTH * 2 + 1), compileSafePattern("^a*$")!)).toBe(false);
  });
});
