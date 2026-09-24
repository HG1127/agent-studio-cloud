import { describe, expect, it } from "vitest";
import { resolveSseCursor } from "@/server/domain/sse-cursor";

describe("实时轨迹续传游标", () => {
  it("首次连接使用页面已经加载的最大序号", () => {
    expect(resolveSseCursor("https://example.test/events?after=18", null)).toBe(18);
  });

  it("自动重连优先使用浏览器携带的较新事件序号", () => {
    expect(resolveSseCursor("https://example.test/events?after=18", "23")).toBe(23);
  });

  it("忽略负数、小数和超出安全范围的游标", () => {
    expect(resolveSseCursor("https://example.test/events?after=-2", "1.5")).toBe(0);
    expect(resolveSseCursor("https://example.test/events?after=999999999999999999999", null)).toBe(0);
  });
});
