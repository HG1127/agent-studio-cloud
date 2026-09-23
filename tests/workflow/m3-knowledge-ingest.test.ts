import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { knowledgeIngestWorkflow } from "@/server/workflows/knowledge-ingest";

const SOURCE_ID = "00000000-0000-4000-8000-0000000000f1";
const SOURCE_ID_FAIL = "00000000-0000-4000-8000-0000000000f2";

describe("知识入库工作流", () => {
  it("文本文件解析切分入库后来源转 indexed", async () => {
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID, workspaceId: DEMO_WORKSPACE_ID, name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 10, sha256: `m3-${SOURCE_ID}`, status: "parsing", createdBy: DEMO_USER_ID,
    });
    try {
      const text = `${"退货政策：签收后 7 天内可退，需保留包装。".repeat(60)}\n${"客户资料说明。".repeat(40)}`;
      const base64 = Buffer.from(text, "utf8").toString("base64");
      const handle = await start(knowledgeIngestWorkflow, [
        { sourceId: SOURCE_ID, filename: "售后手册.txt", mime: "text/plain", base64 },
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
      sizeBytes: 10, sha256: `m3-fail-${SOURCE_ID_FAIL}`, status: "parsing", createdBy: DEMO_USER_ID,
    });
    try {
      const base64 = Buffer.from("fake", "utf8").toString("base64");
      const handle = await start(knowledgeIngestWorkflow, [
        { sourceId: SOURCE_ID_FAIL, filename: "图片.png", mime: "image/png", base64 },
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
});
