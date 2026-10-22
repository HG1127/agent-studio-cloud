import { mkdtemp, writeFile, readFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowAcceptanceContext } from "@/contracts/workflow-case-acceptance";
import { WorkflowAcceptanceOwnedBranchProvenance } from "@/contracts/workflow-acceptance-bridge";

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn(), factory: vi.fn() }));
vi.mock("postgres", () => ({ default: mocks.factory }));
import { observeEmptyOwnedDatabase, runWorkflowAcceptanceBridge } from "../../scripts/workflow-acceptance-case-bridge";

let directory: string;
let fixtureParent: string;
let ownedFixture = false;
const domain = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const context = WorkflowAcceptanceContext.parse({ version: 1, batchId: "22222222-2222-4222-8222-222222222222",
    caseId: "public-tool-approval-idempotency", sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64),
    executionDomainId: domain, databaseBranchId: "br-fixture-child", applicationName: "mvp_wf_" + domain.replaceAll("-", ""),
    sdkDirectory: path.join(directory, "sdk-fixture") });
  const provenance = WorkflowAcceptanceOwnedBranchProvenance.parse({ version: 1, projectId: "cold-recipe-55563307",
    databaseBranchId: context.databaseBranchId, branchName: "mvp-wf-" + domain, executionDomainId: domain,
    batchId: context.batchId, sourceCommit: context.sourceCommit, sourceFingerprint: context.sourceFingerprint,
    createdAt: "2026-01-01T00:00:00Z", endpointId: "ep-fixture", endpointHost: "ep-fixture.example.neon.tech",
    databaseName: "ci_test", creationRequestId: "fixture-only", parentBranchId: "br-fixture-parent",
    databaseId: 1, databaseCreatedAt: "2026-01-01T00:00:01Z", databaseOwner: "neondb_owner" });
  return { context, provenance };
}

beforeEach(async () => {
  ownedFixture = false;
  directory = "";
  fixtureParent = "";
  fixtureParent = await realpath(os.tmpdir());
  directory = await mkdtemp(path.join(fixtureParent, "owned-bridge-mock-"));
  ownedFixture = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-01T00:01:00Z"));
  mocks.query.mockReset().mockResolvedValue([{ user_relations: "0" }]);
  mocks.end.mockReset().mockResolvedValue(undefined);
  mocks.factory.mockReset().mockImplementation(() => Object.assign(mocks.query, { end: mocks.end }));
  vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", "postgresql://fixture:fixture-only@ep-fixture.example.neon.tech/ci_test?sslmode=require");
  vi.stubEnv("MVP_ACCEPTANCE_ISOLATED_DB", "1"); vi.stubEnv("MODEL_MOCK", "1");
});
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  if (!ownedFixture) return;
  const absolute = path.resolve(directory);
  if (!path.isAbsolute(directory) || !path.isAbsolute(fixtureParent) || path.dirname(absolute) !== path.resolve(fixtureParent)
    || !path.basename(absolute).startsWith("owned-bridge-mock-")) throw new Error("拒绝清理非自建样本目录");
  ownedFixture = false;
  await rm(absolute, { recursive: true, force: false });
});

describe("迁移前空库消费者模拟回归", () => {
  it("终结验证失败不读取数据库URI、不构造postgres或写最终成功", async () => {
    const { context, provenance } = fixture();
    await writeFile(path.join(directory, "context.json"), JSON.stringify(context));
    vi.stubEnv("MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", "not-a-database-uri");
    const verify = vi.fn().mockRejectedValue(new Error("fixture-absence-unknown"));
    const cleanup = { status: "not-attempted", databaseBranchId: context.databaseBranchId, ownershipVerified: false,
      lifecycleAuthorizationVerified: false, deletionRequestSucceeded: false, absenceVerified: false };
    await expect(runWorkflowAcceptanceBridge({ version: 1, operation: "finalize", context, provenance, caseDirectory: directory, cleanup }, verify)).rejects.toThrow();
    expect(verify).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: "finalize" }), null);
    expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
    await expect(readFile(path.join(directory, "case-result.json"))).rejects.toThrow();
  });
  it("计数完成时固定观察时间，连接关闭的延迟不续新鲜", async () => {
    const { context, provenance } = fixture(), verify = vi.fn().mockResolvedValue(undefined);
    mocks.query.mockImplementation(async () => { vi.setSystemTime(new Date("2026-01-01T00:01:05Z")); return [{ user_relations: "0" }]; });
    mocks.end.mockImplementation(async () => { vi.setSystemTime(new Date("2026-01-01T00:02:00Z")); });
    const result = await observeEmptyOwnedDatabase(context, provenance, verify);
    expect(result.checkedAt).toBe("2026-01-01T00:01:05.000Z");
    expect(result.userRelationCount).toBe(0);
    expect(verify).toHaveBeenCalledOnce(); expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("原生连接关闭失败不能交付空库观察", async () => {
    const { context, provenance } = fixture();
    mocks.end.mockRejectedValueOnce(new Error("fixture-close-failure"));
    await expect(observeEmptyOwnedDatabase(context, provenance, vi.fn().mockResolvedValue(undefined))).rejects.toThrow("关闭未确认");
  });
  it.each(["unknown", "nonzero"] as const)("%s写原观察后拒绝，不访问进程观察或迁移", async (mode) => {
    const { context, provenance } = fixture();
    await writeFile(path.join(directory, "context.json"), JSON.stringify(context));
    if (mode === "unknown") mocks.query.mockRejectedValueOnce(new Error("fixture-query-failure"));
    else mocks.query.mockResolvedValueOnce([{ user_relations: "3" }]);
    const request = { version: 1, operation: "observe-empty", context, provenance, caseDirectory: directory };
    await expect(runWorkflowAcceptanceBridge(request, vi.fn().mockResolvedValue(undefined))).rejects.toThrow("禁止迁移");
    const result = JSON.parse(await readFile(path.join(directory, "empty-database-observation.json"), "utf8"));
    expect(result.userRelationCount).toBe(mode === "unknown" ? null : 3);
    expect(result.observationStatus).toBe(mode === "unknown" ? "unknown" : "observed");
    expect(mocks.factory).toHaveBeenCalledOnce(); expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
    await expect(readFile(path.join(directory, "case-result.json"))).rejects.toThrow();
  });
  it("零结果只写唯一观察，不要求processObservation或自动迁移", async () => {
    const { context, provenance } = fixture();
    await writeFile(path.join(directory, "context.json"), JSON.stringify(context));
    await runWorkflowAcceptanceBridge({ version: 1, operation: "observe-empty", context, provenance, caseDirectory: directory }, vi.fn().mockResolvedValue(undefined));
    expect(mocks.query).toHaveBeenCalledOnce(); expect(mocks.end).toHaveBeenCalledOnce();
    await expect(runWorkflowAcceptanceBridge({ version: 1, operation: "observe-empty", context, provenance, caseDirectory: directory }, vi.fn().mockResolvedValue(undefined))).rejects.toThrow();
    await expect(readFile(path.join(directory, "case-result.json"))).rejects.toThrow();
  });
});
