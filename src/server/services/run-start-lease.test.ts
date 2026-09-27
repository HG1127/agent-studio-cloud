import { describe, expect, it } from "vitest";
import {
  createRunStartLease,
  isRunStartLeaseExpired,
  readRunStartLease,
  RUN_START_LEASE_KEY,
  RUN_START_LEASE_MS,
  withRunStartLease,
} from "@/server/services/run-start-lease";

describe("运行启动租约", () => {
  it("生成带过期时间的独立租约并保留已有步骤状态", () => {
    const now = new Date("2026-09-25T00:00:00.000Z");
    const first = createRunStartLease(now);
    const second = createRunStartLease(now);
    const states = withRunStartLease({ prepare: { status: "done" } }, first);

    expect(first.token).not.toBe(second.token);
    expect(first.expiresAt).toBe(new Date(now.getTime() + RUN_START_LEASE_MS).toISOString());
    expect(states.prepare).toEqual({ status: "done" });
    expect(states[RUN_START_LEASE_KEY]).toEqual(first);
    expect(readRunStartLease(states)).toEqual(first);
    expect(createRunStartLease(now, 2).attempt).toBe(2);
  });

  it("按租约过期时间判断能否接管，并兼容没有租约的旧记录", () => {
    const updatedAt = new Date("2026-09-25T00:00:00.000Z");
    const lease = createRunStartLease(updatedAt);
    const states = withRunStartLease({}, lease);

    expect(isRunStartLeaseExpired(states, updatedAt, new Date(lease.expiresAt))).toBe(true);
    expect(isRunStartLeaseExpired(states, updatedAt, new Date(updatedAt.getTime() + 1_000))).toBe(false);
    expect(isRunStartLeaseExpired({}, updatedAt, new Date(updatedAt.getTime() + RUN_START_LEASE_MS))).toBe(true);
    expect(readRunStartLease({ [RUN_START_LEASE_KEY]: { token: "bad", expiresAt: "bad" } })).toBeNull();
    expect(readRunStartLease({ [RUN_START_LEASE_KEY]: { token: lease.token, expiresAt: lease.expiresAt } })?.attempt).toBe(1);
  });
});
