import { WorkflowAcceptanceContext, WorkflowAcceptanceDatabaseObservation } from "@/contracts/workflow-case-acceptance";

export type AcceptanceObservationClient = (query: TemplateStringsArray, ...values: string[]) => Promise<unknown>;

function count(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseAcceptanceConnectionCounts(raw: unknown): { databaseConnections: number; activeSql: number } | null {
  if (!Array.isArray(raw) || raw.length !== 1) return null;
  const row: unknown = Object.getOwnPropertyDescriptor(raw, "0")?.value;
  if (!row || typeof row !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(row);
  if (Object.keys(descriptors).length !== 2 || !descriptors.database_connections || !descriptors.active_sql
    || !("value" in descriptors.database_connections) || !("value" in descriptors.active_sql)) return null;
  const databaseConnections = count(descriptors.database_connections.value), activeSql = count(descriptors.active_sql.value);
  if (databaseConnections === null || activeSql === null || activeSql > databaseConnections) return null;
  return { databaseConnections, activeSql };
}

export async function observeWorkflowAcceptanceDatabase(rawContext: unknown, client: AcceptanceObservationClient): Promise<WorkflowAcceptanceDatabaseObservation> {
  const context = WorkflowAcceptanceContext.parse(rawContext);
  let counts: ReturnType<typeof parseAcceptanceConnectionCounts> = null;
  try {
    counts = parseAcceptanceConnectionCounts(await client`
      SELECT count(*)::text AS database_connections,
        count(*) FILTER (WHERE state = 'active')::text AS active_sql
      FROM pg_stat_activity WHERE application_name = ${context.applicationName}
    `);
  } catch { /* Unknown observation is not zero connections. */ }
  return WorkflowAcceptanceDatabaseObservation.parse({
    checkedAt: new Date().toISOString(), applicationName: context.applicationName,
    databaseBranchId: context.databaseBranchId, databaseConnections: counts?.databaseConnections ?? null,
    activeSql: counts?.activeSql ?? null, observationStatus: counts ? "observed" : "unknown",
  });
}

export async function observeUnmigratedUserRelationCount(client: AcceptanceObservationClient): Promise<number | null> {
  try {
    const rows = await client`
      SELECT count(*)::text AS user_relations FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname !~ '^pg_' AND namespace.nspname <> 'information_schema'
        AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
    `;
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const row: unknown = Object.getOwnPropertyDescriptor(rows, "0")?.value;
    if (!row || typeof row !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) return null;
    const descriptor = Object.getOwnPropertyDescriptor(row, "user_relations");
    if (!descriptor || !("value" in descriptor)) return null;
    return count(descriptor.value);
  } catch { return null; }
}
