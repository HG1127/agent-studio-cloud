import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agents, runs } from "@/db/schema";
import { DEMO_USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { listAgents } from "@/server/queries/agents";
import { listRuns } from "@/server/queries/runs";

const WORKSPACE_ID = "00000000-0000-4000-8000-00000000fa00";
const AGENT_IDS = [
  "00000000-0000-4000-8000-00000000fa01",
  "00000000-0000-4000-8000-00000000fa02",
  "00000000-0000-4000-8000-00000000fa03",
];
const RUN_IDS = [
  "00000000-0000-4000-8000-00000000fa04",
  "00000000-0000-4000-8000-00000000fa05",
  "00000000-0000-4000-8000-00000000fa06",
];
const SAME_TIME = new Date("2026-09-27T00:00:00.000Z");

async function cleanup() {
  await db.delete(runs).where(inArray(runs.id, RUN_IDS));
  await db.delete(agents).where(inArray(agents.id, AGENT_IDS));
}

beforeEach(async () => {
  await cleanup();
  await db.insert(agents).values(AGENT_IDS.map((id, index) => ({
    id,
    workspaceId: WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    name: `分页助手${index + 1}`,
    intentText: "验证相同更新时间下的稳定翻页顺序",
    updatedAt: SAME_TIME,
  })));
  await db.insert(runs).values(RUN_IDS.map((id) => ({
    id,
    workspaceId: WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: AGENT_IDS[0],
    versionId: AGENT_IDS[0],
    input: {},
    createdAt: SAME_TIME,
  })));
});

afterEach(cleanup);

describe("相同时间戳的列表翻页", () => {
  it("助手列表以标识作次级排序，不重复或遗漏", async () => {
    const pages = await Promise.all([0, 1, 2].map((offset) =>
      listAgents(WORKSPACE_ID, { limit: 1, offset })));

    expect(pages.map((page) => page[0]?.id)).toEqual([...AGENT_IDS].reverse());
  });

  it("运行列表以标识作次级排序，不重复或遗漏", async () => {
    const pages = await Promise.all([0, 1, 2].map((offset) =>
      listRuns(WORKSPACE_ID, { agentId: AGENT_IDS[0] }, { limit: 1, offset })));

    expect(pages.map((page) => page[0]?.id)).toEqual([...RUN_IDS].reverse());
  });
});
