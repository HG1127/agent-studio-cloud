import path from "node:path";
import { MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES, MAX_WORKFLOW_ACCEPTANCE_OBSERVED_RECORD_BYTES, WorkflowAcceptanceBridgeRequest, WorkflowAcceptanceOwnedBranchProvenance, WorkflowAcceptanceObservedRecord } from "@/contracts/workflow-acceptance-bridge";
import { WorkflowAcceptanceCleanupReceipt } from "@/contracts/workflow-case-acceptance";
import { readOwnedWorkflowJsonWithHash } from "./read-owned-workflow-json";

export async function verifyOwnedWorkflowControlPlane(current: WorkflowAcceptanceBridgeRequest, directUri: string | null,
  dependencies: { fetch?: typeof fetch; environment?: NodeJS.ProcessEnv } = {}): Promise<void> {
  const requestFetch = dependencies.fetch ?? fetch;
  const environment = dependencies.environment ?? process.env;
    const expected = environment.MVP_WORKFLOW_ACCEPTANCE_CREATION_SHA256;
    const key = environment.MVP_WORKFLOW_ACCEPTANCE_CONTROL_KEY;
    if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !key) {
      throw new Error("父自建事件或终结证明未接通，禁止数据库观测");
    }
    const creationFile = await readOwnedWorkflowJsonWithHash(path.join(current.caseDirectory, "creation-provenance.json"), MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES);
    const creation = WorkflowAcceptanceOwnedBranchProvenance.parse(creationFile.value);
    // The parent pins the original UTF-8 bytes; parsed member order is irrelevant to identity.
    if (creationFile.sha256 !== expected
      || Object.entries(creation).some(([field, value]) => current.provenance[field as keyof WorkflowAcceptanceOwnedBranchProvenance] !== value)) throw new Error("父自建记录与目标不一致");
    const provenance = current.provenance;
    if (provenance.projectId !== "cold-recipe-55563307") throw new Error("非验收项目");
    if (current.operation === "finalize") {
      if (directUri !== null) throw new Error("终结阶段禁止数据库连接");
      const cleanupHash = environment.MVP_WORKFLOW_ACCEPTANCE_CLEANUP_SHA256;
      const observedHash = environment.MVP_WORKFLOW_ACCEPTANCE_OBSERVED_SHA256;
      if (!cleanupHash || !observedHash || !/^[a-f0-9]{64}$/.test(cleanupHash) || !/^[a-f0-9]{64}$/.test(observedHash)) throw new Error("父清理与观察文件未固定");
      const cleanupFile = await readOwnedWorkflowJsonWithHash(path.join(current.caseDirectory, "cleanup-receipt.json"), MAX_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_BYTES);
      const observedFile = await readOwnedWorkflowJsonWithHash(path.join(current.caseDirectory, "observed-record.json"), MAX_WORKFLOW_ACCEPTANCE_OBSERVED_RECORD_BYTES);
      if (cleanupFile.sha256 !== cleanupHash || observedFile.sha256 !== observedHash) throw new Error("父原观察或清理回执字节已改变");
      const cleanup = WorkflowAcceptanceCleanupReceipt.parse(cleanupFile.value);
      const observed = WorkflowAcceptanceObservedRecord.parse(observedFile.value);
      if (Object.entries(cleanup).some(([field, value]) => current.cleanup[field as keyof WorkflowAcceptanceCleanupReceipt] !== value)
        || Object.entries(observed.context).some(([field, value]) => current.context[field as keyof typeof current.context] !== value)
        || Object.entries(observed.provenance).some(([field, value]) => provenance[field as keyof WorkflowAcceptanceOwnedBranchProvenance] !== value)
        || observed.caseDirectory !== current.caseDirectory || cleanup.databaseBranchId !== provenance.databaseBranchId
        || cleanup.status !== "deleted-and-verified" || !cleanup.ownershipVerified || !cleanup.lifecycleAuthorizationVerified
        || !cleanup.deletionRequestSucceeded || !cleanup.absenceVerified) throw new Error("终结原证据与本次创建身份不一致");
      for (const relative of ["/branches/" + provenance.databaseBranchId, "/endpoints/" + provenance.endpointId]) {
        try {
          const response = await requestFetch("https://console.neon.tech/api/v2/projects/" + provenance.projectId + relative, {
            method: "GET", headers: { Authorization: "Bearer " + key }, redirect: "error", signal: AbortSignal.timeout(30_000),
          });
          await response.body?.cancel();
          if (response.status !== 404) throw new Error();
        } catch { throw new Error("官方资源缺席未知，终结失败并保留证据"); }
      }
      return;
    }
    if (!directUri || new URL(directUri).hostname !== provenance.endpointHost) throw new Error("父自建记录与直接目标不一致");
    const readOfficial = async (relative: string): Promise<Record<string, unknown>> => {
      try {
        const response = await requestFetch("https://console.neon.tech/api/v2" + relative, {
          method: "GET", headers: { Authorization: "Bearer " + key }, redirect: "error", signal: AbortSignal.timeout(30_000),
        });
        if (response.status !== 200 || !response.body) throw new Error();
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error(); }
            chunks.push(part.value);
          }
        } finally { reader.releaseLock(); }
        const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        return value as Record<string, unknown>;
      } catch { throw new Error("官方身份读取未知，保留资源"); }
    };
    const prefix = "/projects/" + provenance.projectId;
    const branch = (await readOfficial(prefix + "/branches/" + provenance.databaseBranchId)).branch as Record<string, unknown> | undefined;
    const endpoint = (await readOfficial(prefix + "/endpoints/" + provenance.endpointId)).endpoint as Record<string, unknown> | undefined;
    if (!branch || branch.id !== provenance.databaseBranchId || branch.project_id !== provenance.projectId
      || branch.name !== provenance.branchName || branch.created_at !== provenance.createdAt || branch.default !== false
      || branch.parent_id !== provenance.parentBranchId
      || !endpoint || endpoint.id !== provenance.endpointId || endpoint.project_id !== provenance.projectId
      || endpoint.branch_id !== provenance.databaseBranchId || endpoint.host !== provenance.endpointHost || endpoint.type !== "read_write") {
      throw new Error("官方分支和直接端点与本次创建事件不一致");
    }
    const databases = (await readOfficial(prefix + "/branches/" + provenance.databaseBranchId + "/databases")).databases;
    if (!Array.isArray(databases) || databases.filter((database) => database?.name === "ci_test").length !== 1
      || databases.filter((database) => Number.isSafeInteger(database?.id) && database.id === provenance.databaseId
        && database.name === "ci_test" && database.branch_id === provenance.databaseBranchId
        && database.owner_name === provenance.databaseOwner && database.created_at === provenance.databaseCreatedAt).length !== 1) {
      throw new Error("本次专用数据库身份未知");
    }
}
