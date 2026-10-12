import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { HarnessManagedPolicy } from "@/contracts/harness-management";
import { HarnessPolicyDataError } from "@/server/domain/harness/management";

let db: typeof import("@/lib/db").db;
let harnessPolicies: typeof import("@/db/schema").harnessPolicies, harnessPolicyChanges: typeof import("@/db/schema").harnessPolicyChanges;
let HarnessPolicyConflict: typeof import("@/server/services/harness-policies").HarnessPolicyConflict;
let readWorkspaceHarnessPolicy: typeof import("@/server/services/harness-policies").readWorkspaceHarnessPolicy;
let saveManagedHarnessPolicy: typeof import("@/server/services/harness-policies").saveManagedHarnessPolicy;
let isolatedDbReady = false;
beforeAll(async () => {
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("运行规则数据库回归只允许在明确标记的 CI 临时隔离库执行");
  ({ db } = await import("@/lib/db"));
  ({ harnessPolicies, harnessPolicyChanges } = await import("@/db/schema"));
  ({ HarnessPolicyConflict, readWorkspaceHarnessPolicy, saveManagedHarnessPolicy } = await import("@/server/services/harness-policies"));
  isolatedDbReady = true;
});

const ownedWorkspaces: string[] = [], creatorId = randomUUID();
const policy = { version: 1 as const, rules: [{ id: "deny-write", effect: "deny" as const, when: { nodeType: "tool" as const } }] };
const input = () => ({ requestId: randomUUID(), expectedRevision: 0, confirmed: true as const, policy, reason: "隔离数据库规则验收" });
const workspace = () => { const id = randomUUID(); ownedWorkspaces.push(id); return id; };
afterEach(async () => {
  if (!isolatedDbReady) return;
  if (ownedWorkspaces.length) {
    await db.delete(harnessPolicyChanges).where(inArray(harnessPolicyChanges.workspaceId, ownedWorkspaces));
    await db.delete(harnessPolicies).where(inArray(harnessPolicies.workspaceId, ownedWorkspaces));
  }
  ownedWorkspaces.length = 0;
});

// 仅供中央 CI 临时空库：本批未生成迁移，也未执行这些数据库回归。
describe("运行规则真实数据库事务", () => {
  it("两个不同请求同版本竞争只保存一项配置及变更", async () => {
    const id = workspace(), results = await Promise.allSettled([saveManagedHarnessPolicy(input(), id, creatorId), saveManagedHarnessPolicy(input(), id, creatorId)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(HarnessPolicyConflict);
    expect(await db.select().from(harnessPolicyChanges).where(eq(harnessPolicyChanges.workspaceId, id))).toHaveLength(1);
    expect(await readWorkspaceHarnessPolicy(db, id)).toMatchObject({ revision: 1, source: "configured", policy });
  });
  it("同请求并发防重，清空不删除历史，原请求仍找回原版本", async () => {
    const id = workspace(), request = input();
    const results = await Promise.all([saveManagedHarnessPolicy(request, id, creatorId), saveManagedHarnessPolicy(request, id, creatorId)]);
    expect(results).toEqual([expect.objectContaining({ ok: true, recordedRevision: 1 }), expect.objectContaining({ ok: true, recordedRevision: 1 })]);
    await saveManagedHarnessPolicy({ ...input(), expectedRevision: 1, policy: null }, id, creatorId);
    expect(await saveManagedHarnessPolicy(request, id, creatorId)).toMatchObject({ ok: true, recordedRevision: 1, policy: { revision: 2, source: "cleared", policy: null } });
    const changes = await db.select().from(harnessPolicyChanges).where(eq(harnessPolicyChanges.workspaceId, id)).orderBy(harnessPolicyChanges.revision);
    expect(changes).toHaveLength(2); expect(changes[1]).toMatchObject({ previousPolicy: policy, policy: null, revision: 2 });
    await expect(saveManagedHarnessPolicy({ ...request, reason: "换内容" }, id, creatorId)).rejects.toBeInstanceOf(HarnessPolicyConflict);
  });
  it("工作区配置、版本与请求账本互相隔离", async () => {
    const first = workspace(), second = workspace(), request = input();
    await saveManagedHarnessPolicy(request, first, creatorId);
    expect(await readWorkspaceHarnessPolicy(db, second)).toMatchObject({ revision: 0, source: "unconfigured" });
    await saveManagedHarnessPolicy({ ...request, policy: null }, second, creatorId);
    expect(await readWorkspaceHarnessPolicy(db, first)).toMatchObject({ revision: 1, source: "configured" });
    expect(await readWorkspaceHarnessPolicy(db, second)).toMatchObject({ revision: 1, source: "cleared" });
    expect(await db.select().from(harnessPolicyChanges).where(eq(harnessPolicyChanges.workspaceId, first))).toHaveLength(1);
  });
  it("损坏持久内容拒绝读取和覆盖，不伪装成未配置", async () => {
    const id = workspace(); await saveManagedHarnessPolicy(input(), id, creatorId);
    await db.update(harnessPolicies).set({ policy: { version: 2, rules: [] } as unknown as HarnessManagedPolicy }).where(eq(harnessPolicies.workspaceId, id));
    await expect(readWorkspaceHarnessPolicy(db, id)).rejects.toBeInstanceOf(HarnessPolicyDataError);
    await expect(saveManagedHarnessPolicy({ ...input(), expectedRevision: 1 }, id, creatorId)).rejects.toBeInstanceOf(HarnessPolicyDataError);
    expect(await db.select().from(harnessPolicyChanges).where(eq(harnessPolicyChanges.workspaceId, id))).toHaveLength(1);
  });
});
