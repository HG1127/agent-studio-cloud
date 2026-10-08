import { createHash, randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolOperationListInput, type ToolOperationStatus } from "@/contracts/tool-operation";
import { toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listToolOperations } from "@/server/queries/tool-operations";
import { GET } from "@/app/api/tool-operations/route";

let ownedIds: string[] = [];
let sourceRunId: string;
beforeEach(() => { sourceRunId = randomUUID(); });
afterEach(async () => {
  if (ownedIds.length) await db.delete(toolOperations).where(inArray(toolOperations.id, ownedIds));
  ownedIds = [];
});
async function insert(status: ToolOperationStatus = "blocked", workspaceId = DEMO_WORKSPACE_ID, createdAt = "2026-10-08T12:00:00.000123Z", source = sourceRunId) {
  const hash = createHash("sha256").update(randomUUID()).digest("hex");
  const [row] = await db.insert(toolOperations).values({
    workspaceId, createdBy: DEMO_USER_ID, sourceRunId: source, nodeTitle: "登记订单", toolId: "orders.list-test", action: "record",
    keyHash: hash, requestHash: hash, status, createdAt: sql`${createdAt}::timestamptz`, retryDeadline: new Date("2026-10-08T13:00:00Z"),
    error: "apiKey=sk-private-operation-123456", receipt: { hiddenBody: "private-receipt-123456" },
    resolutions: [{ requestId: randomUUID(), kind: "record-receipt", createdBy: DEMO_USER_ID, createdAt: "2026-10-08T12:00:00Z", reason: "private-resolution-123456", requestHash: hash }],
  }).returning({ id: toolOperations.id });
  ownedIds.push(row.id);
  return row.id;
}
describe("持久业务操作列表与稳定游标", () => {
  it("同一毫秒内不同微秒及相同时间记录翻页不遗漏、不重复", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, (_, index) => insert("blocked", DEMO_WORKSPACE_ID,
      index < 3 ? "2026-10-08T12:00:00.000456Z" : "2026-10-08T12:00:00.000123Z")));
    let cursor: { createdAt: string; id: string } | null = null;
    const found: string[] = [];
    do {
      const page = await listToolOperations(DEMO_WORKSPACE_ID, ToolOperationListInput.parse({ sourceRunId, limit: 2,
        ...(cursor ? { before: cursor.createdAt, beforeId: cursor.id } : {}),
      }));
      if (!page.ok) throw new Error(page.error);
      found.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor) expect(cursor.createdAt).toMatch(/\.000(?:123|456)Z$/);
      expect(found.length).toBeLessThanOrEqual(ids.length);
    } while (cursor);
    expect(found).toHaveLength(ids.length);
    expect(new Set(found)).toEqual(new Set(ids));
  });
  it("状态与首次来源运行筛选不跨工作区，也不返回业务或核对正文", async () => {
    const target = await insert();
    await insert("completed");
    await insert("blocked", randomUUID());
    await insert("blocked", DEMO_WORKSPACE_ID, "2026-10-08T12:00:00.000123Z", randomUUID());
    const result = await listToolOperations(DEMO_WORKSPACE_ID, ToolOperationListInput.parse({ status: "blocked", sourceRunId }));
    if (!result.ok) throw new Error(result.error);
    expect(result.items.map((item) => item.id)).toEqual([target]);
    expect(result.items[0].resolutionCount).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/sk-private|private-receipt|private-resolution|keyHash|requestHash|cursorCreatedAt/);
    expect(result.nextCursor).toBeNull();
  });
  it("首页之后插入新记录不让下一页重复此前记录", async () => {
    const older = await insert("blocked", DEMO_WORKSPACE_ID, "2026-10-08T11:00:00.000123Z");
    const newer = await insert();
    const first = await listToolOperations(DEMO_WORKSPACE_ID, ToolOperationListInput.parse({ sourceRunId, limit: 1 }));
    if (!first.ok || !first.nextCursor) throw new Error("应有下一页");
    expect(first.items[0].id).toBe(newer);
    await insert("blocked", DEMO_WORKSPACE_ID, "2026-10-08T12:01:00.000123Z");
    const next = await listToolOperations(DEMO_WORKSPACE_ID, ToolOperationListInput.parse({ sourceRunId, limit: 1, before: first.nextCursor.createdAt, beforeId: first.nextCursor.id }));
    expect(next).toMatchObject({ ok: true, items: [{ id: older }], nextCursor: null });
  });
  it("真实 HTTP 处理器读取数据库列表并返回可用于详情核对的标识", async () => {
    const id = await insert();
    const response = await GET(new Request(`http://localhost/api/tool-operations?status=blocked&sourceRunId=${sourceRunId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, items: [{ id, status: "blocked", resolutionCount: 1 }], nextCursor: null });
  });
});
