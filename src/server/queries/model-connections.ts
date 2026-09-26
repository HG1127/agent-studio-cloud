import { and, desc, eq, isNull } from "drizzle-orm";
import { ModelConnectionView, type ModelConnectionView as ModelConnectionViewType } from "@/contracts/connections";
import { modelConnections } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { realModelsEnabled } from "@/lib/model";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

export async function listModelConnections(): Promise<ModelConnectionViewType[]> {
  if (!realModelsEnabled()) return [];
  const rows = await db.select({
    id: modelConnections.id,
    name: modelConnections.name,
    baseUrl: modelConnections.baseUrl,
    apiKeyHint: modelConnections.apiKeyHint,
    modelIds: modelConnections.modelIds,
    isDefaultCompile: modelConnections.isDefaultCompile,
    createdAt: modelConnections.createdAt,
  }).from(modelConnections)
    .where(and(eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID), isNull(modelConnections.archivedAt)))
    .orderBy(desc(modelConnections.createdAt));
  return parseQueryRows(
    "模型连接列表",
    ModelConnectionView,
    rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  );
}
