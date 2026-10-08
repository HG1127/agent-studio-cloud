import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { traceEvents, waitEventSubmissions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { canonicalJson } from "@/server/domain/canonical-json";

const CLAIM_TTL_MS = 30_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function waitEventPayloadHash(payload: Record<string, unknown>): string {
  return sha256(canonicalJson(payload));
}

export function waitEventSubmissionTokenHash(token: string): string {
  return sha256(token);
}

export async function findWaitEventSubmission(submissionToken: string) {
  const [row] = await db
    .select()
    .from(waitEventSubmissions)
    .where(and(
      eq(waitEventSubmissions.workspaceId, DEMO_WORKSPACE_ID),
      eq(waitEventSubmissions.submissionTokenHash, waitEventSubmissionTokenHash(submissionToken)),
    ))
    .limit(1);
  return row ?? null;
}

export function waitEventSubmissionMatches(
  row: { runId: string; eventKey: string; payloadHash: string },
  input: { runId: string; eventKey: string; payload: Record<string, unknown> },
): boolean {
  return row.runId === input.runId
    && row.eventKey === input.eventKey
    && row.payloadHash === waitEventPayloadHash(input.payload);
}

export async function claimWaitEventSubmission(input: {
  runId: string;
  eventKey: string;
  submissionToken: string;
  payload: Record<string, unknown>;
  hookToken: string;
}): Promise<
  | { state: "claimed"; id: string; attemptToken: string; payload: Record<string, unknown>; hookToken: string }
  | { state: "accepted" }
  | { state: "processing" }
  | { state: "conflict" }
> {
  const now = new Date();
  const attemptToken = randomUUID();
  const submissionTokenHash = waitEventSubmissionTokenHash(input.submissionToken);
  const payloadHash = waitEventPayloadHash(input.payload);
  const [created] = await db
    .insert(waitEventSubmissions)
    .values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      runId: input.runId,
      eventKey: input.eventKey,
      submissionTokenHash,
      payloadHash,
      payload: input.payload,
      hookToken: input.hookToken,
      attemptToken,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: waitEventSubmissions.id });
  if (created) {
    return { state: "claimed", id: created.id, attemptToken, payload: input.payload, hookToken: input.hookToken };
  }

  const existing = await findWaitEventSubmission(input.submissionToken);
  if (!existing || !waitEventSubmissionMatches(existing, input) || existing.hookToken !== input.hookToken) {
    return { state: "conflict" };
  }
  if (existing.status === "accepted") return { state: "accepted" };

  const expiredBefore = new Date(now.getTime() - CLAIM_TTL_MS);
  const [claimed] = await db
    .update(waitEventSubmissions)
    .set({ attemptToken, updatedAt: now })
    .where(and(
      eq(waitEventSubmissions.id, existing.id),
      eq(waitEventSubmissions.status, "processing"),
      lt(waitEventSubmissions.updatedAt, expiredBefore),
    ))
    .returning({ id: waitEventSubmissions.id });
  return claimed
    ? { state: "claimed", id: claimed.id, attemptToken, payload: existing.payload, hookToken: existing.hookToken }
    : { state: "processing" };
}

export async function markWaitEventSubmissionAccepted(id: string, attemptToken: string): Promise<void> {
  const now = new Date();
  await db
    .update(waitEventSubmissions)
    .set({ status: "accepted", acceptedAt: now, updatedAt: now })
    .where(and(
      eq(waitEventSubmissions.id, id),
      eq(waitEventSubmissions.attemptToken, attemptToken),
      eq(waitEventSubmissions.status, "processing"),
    ));
}

export async function waitEventOutcome(runId: string, hookToken: string): Promise<"resumed" | "timed_out" | null> {
  const [started] = await db
    .select({ seq: traceEvents.seq, nodeId: traceEvents.nodeId })
    .from(traceEvents)
    .where(and(
      eq(traceEvents.workspaceId, DEMO_WORKSPACE_ID),
      eq(traceEvents.runId, runId),
      eq(traceEvents.kind, "wait.started"),
      sql`${traceEvents.data} ->> 'hookToken' = ${hookToken}`,
    ))
    .limit(1);
  if (!started?.nodeId) return null;
  const [outcome] = await db
    .select({ kind: traceEvents.kind })
    .from(traceEvents)
    .where(and(
      eq(traceEvents.workspaceId, DEMO_WORKSPACE_ID),
      eq(traceEvents.runId, runId),
      eq(traceEvents.nodeId, started.nodeId),
      inArray(traceEvents.kind, ["wait.resumed", "wait.timed_out"]),
      gt(traceEvents.seq, started.seq),
    ))
    .orderBy(asc(traceEvents.seq))
    .limit(1);
  return outcome?.kind === "wait.resumed" ? "resumed"
    : outcome?.kind === "wait.timed_out" ? "timed_out" : null;
}
