import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowAcceptanceBridgeRequest, WorkflowAcceptanceObservedRecord } from "@/contracts/workflow-acceptance-bridge";
import { verifyOwnedWorkflowControlPlane } from "../helpers/verify-owned-workflow-control-plane";

const pg = vi.hoisted(() => vi.fn(() => { throw new Error("终结不应构造PG"); }));
vi.mock("postgres", () => ({ default: pg }));
let directory: string, request: Extract<WorkflowAcceptanceBridgeRequest, { operation: "finalize" }>;
let observed: WorkflowAcceptanceObservedRecord, environment: NodeJS.ProcessEnv;
const pins = [
  ["creation-provenance.json", "MVP_WORKFLOW_ACCEPTANCE_CREATION_SHA256"],
  ["cleanup-receipt.json", "MVP_WORKFLOW_ACCEPTANCE_CLEANUP_SHA256"],
  ["observed-record.json", "MVP_WORKFLOW_ACCEPTANCE_OBSERVED_SHA256"],
] as const;
async function pin(file: string, key: string, value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  await writeFile(path.join(directory, file), bytes);
  environment[key] = createHash("sha256").update(bytes).digest("hex");
}
const absentFetch = () => vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 404 }));
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "owned-control-mock-"));
  const domain = "11111111-1111-4111-8111-111111111111";
  const context = { version: 1, batchId: "22222222-2222-4222-8222-222222222222", caseId: "harness-retry",
    sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: domain,
    databaseBranchId: "br-own-fixture", applicationName: "mvp_wf_" + domain.replaceAll("-", ""), sdkDirectory: path.join(directory, "sdk") };
  const provenance = { version: 1, projectId: "cold-recipe-55563307", databaseBranchId: context.databaseBranchId,
    branchName: "mvp-wf-" + domain, executionDomainId: domain, batchId: context.batchId,
    sourceCommit: context.sourceCommit, sourceFingerprint: context.sourceFingerprint, createdAt: "2026-01-01T00:00:00Z",
    endpointId: "ep-own-fixture", endpointHost: "ep-own-fixture.example.neon.tech", databaseName: "ci_test",
    creationRequestId: "fixture-only", databaseId: 1, databaseCreatedAt: "2026-01-01T00:00:01Z",
    databaseOwner: "neondb_owner", parentBranchId: "br-parent-fixture" };
  const cleanup = { status: "deleted-and-verified", databaseBranchId: context.databaseBranchId,
    ownershipVerified: true, lifecycleAuthorizationVerified: true, deletionRequestSucceeded: true, absenceVerified: true };
  const parsed = WorkflowAcceptanceBridgeRequest.parse({ version: 1, operation: "finalize", context, provenance, cleanup, caseDirectory: directory });
  if (parsed.operation !== "finalize") throw new Error("夹具分支错误");
  request = parsed;
  const pool = "33333333-3333-4333-8333-333333333333";
  observed = WorkflowAcceptanceObservedRecord.parse({ version: 1, context, provenance, caseDirectory: directory, ownedProcessIds: [123],
    child: { version: 1, context, businessStatus: "passed", failureCode: null, cleanupPermitted: false,
      realms: [{ executionDomainId: domain, realmId: "44444444-4444-4444-8444-444444444444", processId: 123, threadId: 0,
        pools: { ownerId: domain, state: "callbacks_completed", poolIds: [pool], completedIds: [pool], failedIds: [], unknownIds: [], cleanupPermitted: false } }] },
    observation: { executionDomainId: domain, sourceMatched: true, launchOwnershipVerified: true, termination: "natural", exitCode: 0,
      processObservationComplete: true, remainingOwnedProcesses: 0, allRealmReceiptsCollected: true, ownedBranchVerified: true,
      applicationName: context.applicationName, databaseBranchId: context.databaseBranchId, databaseObservationComplete: true,
      databaseSnapshotFresh: true, databaseConnections: 0, activeSql: 0, sdkDirectoryOwnershipVerified: true },
    databaseObservation: { checkedAt: "2026-01-01T00:01:00Z", applicationName: context.applicationName,
      databaseBranchId: context.databaseBranchId, databaseConnections: 0, activeSql: 0, observationStatus: "observed" },
    observedAt: "2026-01-01T00:01:01Z" });
  environment = { NODE_ENV: "test", MVP_WORKFLOW_ACCEPTANCE_CONTROL_KEY: "dummy-control-key-never-production" };
  await pin(...pins[0], request.provenance); await pin(...pins[1], request.cleanup); await pin(...pins[2], observed);
  pg.mockClear();
});
afterEach(async () => {
  expect(pg).not.toHaveBeenCalled(); vi.restoreAllMocks();
  const absolute = path.resolve(directory);
  if (!path.isAbsolute(directory) || path.dirname(absolute) !== path.resolve(os.tmpdir())
    || !path.basename(absolute).startsWith("owned-control-mock-")) throw new Error("拒绝清理非自建样本目录");
  await rm(absolute, { recursive: true, force: false });
});

describe("父原字节与官方缺席核验模拟", () => {
  it.each(pins.flatMap(([file, key]) => [undefined, "c".repeat(64)].map((value) => ({ file, key, value }))))("缺失或错误SHA拒绝 $file/$value", async ({ key, value }) => {
    environment[key] = value;
    const network = absentFetch();
    await expect(verifyOwnedWorkflowControlPlane(request, null, { fetch: network, environment })).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["creation", "cleanup", "observed"] as const)("原字节已钉住但%s语义与请求不一致仍拒绝", async (kind) => {
    if (kind === "creation") await pin(...pins[0], { ...request.provenance, databaseId: 2 });
    if (kind === "cleanup") await pin(...pins[1], { ...request.cleanup, databaseBranchId: "br-other-fixture" });
    if (kind === "observed") await pin(...pins[2], { ...observed, caseDirectory: path.join(directory, "other") });
    const network = absentFetch();
    await expect(verifyOwnedWorkflowControlPlane(request, null, { fetch: network, environment })).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["branch", "endpoint"].flatMap((target) => [200, 401, 403].map((status) => ({ target, status }))))("$target返回$status不是缺席", async ({ target, status }) => {
    const network = vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(null, {
      status: String(url).includes(target === "branch" ? "/branches/" : "/endpoints/") ? status : 404,
    }));
    await expect(verifyOwnedWorkflowControlPlane(request, null, { fetch: network, environment })).rejects.toThrow("缺席未知");
  });
  it.each(["network", "redirect"])("%s异常保持未知", async (kind) => {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("dummy-" + kind));
    await expect(verifyOwnedWorkflowControlPlane(request, null, { fetch: network, environment })).rejects.toThrow("缺席未知");
    expect(network.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
  });
  it("同语义成员倒序及空白的原字节仍能验证，不读数据库环境", async () => {
    const bytes = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(request.provenance).reverse()), null, 2), "utf8");
    await writeFile(path.join(directory, pins[0][0]), bytes);
    environment[pins[0][1]] = createHash("sha256").update(bytes).digest("hex");
    Object.defineProperty(environment, "MVP_WORKFLOW_ACCEPTANCE_DATABASE_URL_UNPOOLED", { get: () => { throw new Error("终结不可读取URI"); } });
    const network = absentFetch();
    await verifyOwnedWorkflowControlPlane(request, null, { fetch: network, environment });
    expect(network).toHaveBeenCalledTimes(2);
    expect(String(network.mock.calls[0][0])).toContain("/branches/br-own-fixture");
    expect(String(network.mock.calls[1][0])).toContain("/endpoints/ep-own-fixture");
  });
  it("终结传入数据库URI直接拒绝", async () => {
    const network = absentFetch();
    await expect(verifyOwnedWorkflowControlPlane(request, "dummy-not-a-uri", { fetch: network, environment })).rejects.toThrow("禁止数据库连接");
    expect(network).not.toHaveBeenCalled();
  });
});
