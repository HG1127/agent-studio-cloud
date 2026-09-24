import { and, desc, eq, isNull } from "drizzle-orm";
import { ModelConnectionView } from "@/contracts/connections";
import { modelConnections } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { realModelsEnabled } from "@/lib/model";

export async function listModelConnections(): Promise<ModelConnectionView[]> {
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
  return rows.map((row) => ModelConnectionView.parse({ ...row, createdAt: row.createdAt.toISOString() }));
}
