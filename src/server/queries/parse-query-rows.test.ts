import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

afterEach(() => vi.restoreAllMocks());

describe("查询结果逐条契约隔离", () => {
  it("保留有效记录并跳过坏记录", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const schema = z.object({ id: z.string().uuid(), status: z.enum(["ready", "done"]) });

    const rows = parseQueryRows("测试列表", schema, [
      { id: "00000000-0000-4000-8000-000000000001", status: "ready" },
      { id: "bad-id", status: "broken" },
      { id: "00000000-0000-4000-8000-000000000002", status: "done" },
    ]);

    expect(rows).toEqual([
      { id: "00000000-0000-4000-8000-000000000001", status: "ready" },
      { id: "00000000-0000-4000-8000-000000000002", status: "done" },
    ]);
    expect(warn).toHaveBeenCalledWith("[query] 已忽略 1 条不符合测试列表契约的历史记录");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("bad-id");
  });

  it("全部有效时不产生告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(parseQueryRows("文字列表", z.string(), ["甲", "乙"])).toEqual(["甲", "乙"]);
    expect(warn).not.toHaveBeenCalled();
  });
});
