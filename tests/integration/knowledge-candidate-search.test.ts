import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { searchKnowledgeChunks } from "@/server/queries/knowledge";
import { MAX_KNOWLEDGE_SCAN_CHUNKS } from "@/server/domain/knowledge/search";

const SOURCE_ID = "00000000-0000-4000-8000-0000000000f9";

async function cleanup() {
  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID));
  await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID));
}

beforeEach(cleanup);
afterEach(cleanup);

describe("知识检索候选分片", () => {
  it("超过扫描上限时优先找到旧顺序之后的完整查询命中", async () => {
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      name: "长篇售后资料",
      mime: "text/plain",
      sizeBytes: 100_000,
      sha256: `candidate-search-${SOURCE_ID}`,
      status: "indexed",
      chunkCount: MAX_KNOWLEDGE_SCAN_CHUNKS + 1,
    });
    const filler = Array.from({ length: MAX_KNOWLEDGE_SCAN_CHUNKS }, (_, index) => ({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      sourceId: SOURCE_ID,
      chunkIndex: index,
      content: "海蓝灯背景信息，尚无完整验收标记。",
      charStart: index * 20,
      charEnd: index * 20 + 17,
    }));
    await db.insert(knowledgeChunks).values([
      ...filler,
      {
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        sourceId: SOURCE_ID,
        chunkIndex: MAX_KNOWLEDGE_SCAN_CHUNKS,
        content: "关键内容：检索海蓝灯塔二四资料。",
        charStart: MAX_KNOWLEDGE_SCAN_CHUNKS * 20,
        charEnd: MAX_KNOWLEDGE_SCAN_CHUNKS * 20 + 17,
      },
    ]);

    const result = await searchKnowledgeChunks("检索海蓝灯塔二四资料");

    expect(result.hits[0]).toMatchObject({ sourceId: SOURCE_ID, chunkIndex: MAX_KNOWLEDGE_SCAN_CHUNKS });
    expect(result.truncated).toBe(true);
  }, 60_000);
});
