import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  selectCalls: 0,
  selectedFilters: [] as unknown[][],
  recentRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      const recent = mocks.selectCalls++ === 0;
      return {
        from: () => ({
          where: (filter: SQL) => ({
            orderBy: () => recent
              ? { limit: async () => mocks.recentRows }
              : Promise.resolve((() => {
                const params = new PgDialect().sqlToQuery(filter).params;
                mocks.selectedFilters.push(params);
                return params.filter((value): value is string => typeof value === "string" && value.startsWith("00000000-0000-4000-8000-"))
                  .map((id) => ({
                    id, name: id, mime: "text/plain", sizeBytes: 1, status: "indexed",
                    chunkCount: 1, charCount: 1, error: null, blobPathname: null,
                    createdAt: new Date("2026-09-27T00:00:00.000Z"),
                    updatedAt: new Date("2026-09-27T00:00:00.000Z"),
                  }));
              })()),
          }),
        }),
      };
    },
  },
}));

import { listKnowledgeSourcesForPicker } from "@/server/queries/knowledge";

beforeEach(() => {
  mocks.selectCalls = 0;
  mocks.selectedFilters = [];
  mocks.recentRows = [];
});

describe("流程资料选择器", () => {
  it("分批读取超过旧版 200 条上限的全部已选资料", async () => {
    const selectedIds = Array.from({ length: 1_001 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);

    const sources = await listKnowledgeSourcesForPicker([...selectedIds, selectedIds[0], "invalid"]);

    expect(sources).toHaveLength(selectedIds.length);
    expect(new Set(sources.map((source) => source.id))).toEqual(new Set(selectedIds));
    expect(mocks.selectedFilters).toHaveLength(2);
    expect(mocks.selectedFilters[0]).toContain(selectedIds[200]);
    expect(mocks.selectedFilters[1]).toContain(selectedIds[1_000]);
    expect(mocks.selectedFilters.every((params) => params.length <= 1_003)).toBe(true);
  });
});
