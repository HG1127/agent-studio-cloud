import { randomUUID } from "node:crypto";
import { z } from "zod";

export const RUN_START_LEASE_KEY = "__startup";
export const RUN_START_LEASE_MS = 2 * 60 * 1_000;
export const MAX_RUN_START_ATTEMPTS = 3;

const RunStartLease = z.object({
  token: z.string().uuid(),
  expiresAt: z.iso.datetime(),
  attempt: z.number().int().min(1).default(1),
});
export type RunStartLease = z.infer<typeof RunStartLease>;

export function createRunStartLease(now = new Date(), attempt = 1): RunStartLease {
  return {
    token: randomUUID(),
    expiresAt: new Date(now.getTime() + RUN_START_LEASE_MS).toISOString(),
    attempt,
  };
}

export function readRunStartLease(stepStates: unknown): RunStartLease | null {
  if (!stepStates || typeof stepStates !== "object" || Array.isArray(stepStates)) return null;
  const parsed = RunStartLease.safeParse((stepStates as Record<string, unknown>)[RUN_START_LEASE_KEY]);
  return parsed.success ? parsed.data : null;
}

export function withRunStartLease(stepStates: unknown, lease: RunStartLease): Record<string, unknown> {
  const base = stepStates && typeof stepStates === "object" && !Array.isArray(stepStates)
    ? stepStates as Record<string, unknown>
    : {};
  return { ...base, [RUN_START_LEASE_KEY]: lease };
}

export function isRunStartLeaseExpired(stepStates: unknown, updatedAt: Date, now = new Date()): boolean {
  const lease = readRunStartLease(stepStates);
  const expiresAt = lease ? new Date(lease.expiresAt).getTime() : updatedAt.getTime() + RUN_START_LEASE_MS;
  return expiresAt <= now.getTime();
}
