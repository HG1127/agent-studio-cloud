import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { knowledgeIngestWorkflow } from "@/server/workflows/knowledge-ingest";

const SOURCE_ID = "00000000-0000-4000-8000-0000000000f1";
const SOURCE_ID_FAIL = "00000000-0000-4000-8000-0000000000f2";
const SOURCE_ID_ARCHIVED = "00000000-0000-4000-8000-0000000000f3";
const SOURCE_ID_STALE = "00000000-0000-4000-8000-0000000000f4";
const TOKEN = "pending:test-current-ingest";

describe("知识入库工作流", () => {
  it("归档期间完成的迟到解析不会重新启用资料", async () => {
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID_ARCHIVED, workspaceId: DEMO_WORKSPACE_ID, name: "归档资料.txt", mime: "text/plain",
      sizeBytes: 10, sha256: `m3-${SOURCE_ID_ARCHIVED}`, status: "archived", archivedAt: new Date(), parseEngine: TOKEN, createdBy: DEMO_USER_ID,
    });
    try {
      const handle = await start(knowledgeIngestWorkflow, [
        { sourceId: SOURCE_ID_ARCHIVED, filename: "归档资料.txt", mime: "text/plain", content: new Blob(["已归档但解析完成的内容"]).stream(), ingestToken: TOKEN },
      ]);
      const result = await handle.returnValue;
      const [source] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID_ARCHIVED)).limit(1);
      expect(source).toMatchObject({ status: "archived", archivedAt: expect.any(Date), chunkCount: result.chunkCount });
    } finally {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID_ARCHIVED));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID_ARCHIVED));
    }
  }, 240_000);

  it("文本文件解析切分入库后来源转 indexed", async () => {
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID, workspaceId: DEMO_WORKSPACE_ID, name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 10, sha256: `m3-${SOURCE_ID}`, status: "parsing", parseEngine: TOKEN, createdBy: DEMO_USER_ID,
    });
    try {
      const text = `${"退货政策：签收后 7 天内可退，需保留包装。".repeat(60)}\n${"客户资料说明。".repeat(40)}`;
      const handle = await start(knowledgeIngestWorkflow, [
        { sourceId: SOURCE_ID, filename: "售后手册.txt", mime: "text/plain", content: new Blob([text]).stream(), ingestToken: TOKEN },
      ]);
      const result = await handle.returnValue;
      expect(result.chunkCount).toBeGreaterThan(1);
      const [source] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID)).limit(1);
      expect(source?.status).toBe("indexed");
      expect(source?.chunkCount).toBe(result.chunkCount);
      const chunks = await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID));
      expect(chunks.length).toBe(result.chunkCount);
      expect(chunks[0].content).toContain("退货政策");
    } finally {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID));
    }
  }, 240_000);

  it("不支持的类型落 failed 并带中文原因", async () => {
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID_FAIL, workspaceId: DEMO_WORKSPACE_ID, name: "图片.png", mime: "image/png",
      sizeBytes: 10, sha256: `m3-fail-${SOURCE_ID_FAIL}`, status: "parsing", parseEngine: TOKEN, createdBy: DEMO_USER_ID,
    });
    try {
      const handle = await start(knowledgeIngestWorkflow, [
        { sourceId: SOURCE_ID_FAIL, filename: "图片.png", mime: "image/png", content: new Blob(["fake"]).stream(), ingestToken: TOKEN },
      ]);
      await expect(handle.returnValue).rejects.toThrow();
      const [source] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID_FAIL)).limit(1);
      expect(source?.status).toBe("failed");
      expect(source?.error).toContain("暂不支持");
    } finally {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID_FAIL));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID_FAIL));
    }
  }, 240_000);

  it("旧解析任务不能覆盖新任务的状态和分片", async () => {
    const currentToken = "pending:new-ingest";
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID_STALE, workspaceId: DEMO_WORKSPACE_ID, name: "竞态资料.txt", mime: "text/plain",
      sizeBytes: 10, sha256: `m3-stale-${SOURCE_ID_STALE}`, status: "parsing", parseEngine: currentToken, createdBy: DEMO_USER_ID,
    });
    try {
      const handle = await start(knowledgeIngestWorkflow, [{
        sourceId: SOURCE_ID_STALE,
        filename: "竞态资料.txt",
        mime: "text/plain",
        content: new Blob(["旧任务晚到的内容"]).stream(),
        ingestToken: "pending:old-ingest",
      }]);
      await expect(handle.returnValue).rejects.toThrow();
      const [source] = await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID_STALE)).limit(1);
      expect(source).toMatchObject({ status: "parsing", parseEngine: currentToken, error: null, chunkCount: 0 });
      expect(await db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID_STALE))).toHaveLength(0);
    } finally {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID_STALE));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID_STALE));
    }
  }, 240_000);
});
