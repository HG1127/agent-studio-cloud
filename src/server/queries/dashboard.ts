import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { DashboardSummary } from "@/contracts/dashboard";
import { agentVersions, agents, approvals, knowledgeSources, runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

const countValue = sql<number>`count(*)`.mapWith(Number);

export async function getDashboardSummary() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const [activeAgentRows, publishedAgentRows, sourceRows, activeRunRows, approvalRows, eventRows, recentRunRows] = await Promise.all([
    db.select({ count: countValue }).from(agents).where(and(
      eq(agents.workspaceId, DEMO_WORKSPACE_ID),
      isNull(agents.archivedAt),
    )),
    db.select({ count: sql<number>`count(distinct ${agentVersions.agentId})`.mapWith(Number) })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
        eq(agents.workspaceId, DEMO_WORKSPACE_ID),
        eq(agentVersions.status, "production"),
        isNull(agents.archivedAt),
      )),
    db.select({ count: countValue }).from(knowledgeSources).where(and(
      eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
      eq(knowledgeSources.status, "indexed"),
      isNull(knowledgeSources.archivedAt),
    )),
    db.select({ count: countValue }).from(runs).where(and(
      eq(runs.workspaceId, DEMO_WORKSPACE_ID),
      inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"]),
    )),
    db.select({ count: countValue }).from(approvals).innerJoin(runs, eq(runs.id, approvals.runId)).where(and(
      eq(approvals.workspaceId, DEMO_WORKSPACE_ID),
      eq(runs.workspaceId, DEMO_WORKSPACE_ID),
      eq(approvals.status, "pending"),
      eq(runs.status, "waiting_approval"),
    )),
    db.select({ count: countValue }).from(runs).where(and(
      eq(runs.workspaceId, DEMO_WORKSPACE_ID),
      eq(runs.status, "waiting_event"),
    )),
    db.select({
      total: countValue,
      failed: sql<number>`count(*) filter (where ${runs.status} = 'failed')`.mapWith(Number),
    }).from(runs).where(and(
      eq(runs.workspaceId, DEMO_WORKSPACE_ID),
      gte(runs.createdAt, since),
    )),
  ]);
  return DashboardSummary.parse({
    activeAgents: activeAgentRows[0]?.count ?? 0,
    publishedAgents: publishedAgentRows[0]?.count ?? 0,
    indexedSources: sourceRows[0]?.count ?? 0,
    activeRuns: activeRunRows[0]?.count ?? 0,
    pendingApprovals: approvalRows[0]?.count ?? 0,
    pendingEvents: eventRows[0]?.count ?? 0,
    runsLast24h: recentRunRows[0]?.total ?? 0,
    failuresLast24h: recentRunRows[0]?.failed ?? 0,
  });
}
