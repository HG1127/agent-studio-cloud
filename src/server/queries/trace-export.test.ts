import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  filters: [] as SQL[],
  rows: [] as Array<{ seq: number }>,
}));

vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));

import { getLatestTraceSeq, listTraceSince } from "@/server/queries/trace";

const RUN_ID = "00000000-0000-4000-8000-0000000000c1";
const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000c2";

beforeEach(() => {
  mocks.filters = [];
  mocks.rows = [];
  mocks.select.mockReset().mockImplementation(() => ({
    from: () => ({
      where: (filter: SQL) => {
        mocks.filters.push(filter);
        return { orderBy: () => ({ limit: async () => mocks.rows }) };
      },
    }),
  }));
});

describe("运行轨迹导出边界", () => {
  it("读取当前最大序号，并在分页时加入固定上界", async () => {
    mocks.rows = [{ seq: 7 }];
    expect(await getLatestTraceSeq(RUN_ID, WORKSPACE_ID)).toBe(7);
    mocks.rows = [];

    await listTraceSince(RUN_ID, WORKSPACE_ID, 2, 7);

    const query = new PgDialect().sqlToQuery(mocks.filters[1]);
    expect(query.sql).toContain('"trace_events"."seq" <=');
    expect(query.params).toEqual([RUN_ID, WORKSPACE_ID, 2, 7]);
  });

  it("实时事件流不传上界时仍可继续读取新轨迹", async () => {
    await listTraceSince(RUN_ID, WORKSPACE_ID, 2);

    const query = new PgDialect().sqlToQuery(mocks.filters[0]);
    expect(query.sql).not.toContain('"trace_events"."seq" <=');
    expect(query.params).toEqual([RUN_ID, WORKSPACE_ID, 2]);
  });

  it("无效运行标识不查询轨迹", async () => {
    expect(await getLatestTraceSeq("invalid", WORKSPACE_ID)).toBe(0);
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
