import { AgentManifest } from "@/contracts/manifest";
import { freezePublicToolPublication } from "@/server/domain/public-agent-tool";
import { PublicToolStoredCall, PublicToolView } from "@/contracts/public-agent-tool";

export const PUBLIC_TOOL_TEST_IDS = {
  tool: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", request: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  agent: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", version: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  publication: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", call: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  key: "11111111-1111-4111-8111-111111111111", run: "22222222-2222-4222-8222-222222222222",
};
export function publicToolTestManifest(agentId = PUBLIC_TOOL_TEST_IDS.agent) {
  const outputContract = { fields: [{ path: "delivery", sourceNodeId: "record", sourcePath: [], required: true }] };
  return AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "public-tool-test", outputContract,
    inputContract: { fields: [{ name: "amount", type: "number", required: true }, { name: "approved", type: "boolean", required: true }] },
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", criticalCount: 0, issueCount: 0 },
    workflowSnapshot: {
      id: "public-tool-test", rootAgent: { id: agentId, name: "公开处理助手", role: "测试" }, startNodeId: "start", outputContract,
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: { start: { id: "start", title: "开始", type: "trigger", next: "record" },
        record: { id: "record", title: "记录成果", type: "system", system: { kind: "record" }, next: "done" },
        done: { id: "done", title: "完成", type: "end", next: null } },
    },
  });
}
export function publicToolTestPublication() {
  return freezePublicToolPublication({ agentId: PUBLIC_TOOL_TEST_IDS.agent, versionId: PUBLIC_TOOL_TEST_IDS.version,
    version: 1, publicationId: PUBLIC_TOOL_TEST_IDS.publication, now: new Date("2026-10-12T00:00:00.000Z"), manifest: publicToolTestManifest() });
}
export function publicToolTestView() {
  return PublicToolView.parse({ toolId: PUBLIC_TOOL_TEST_IDS.tool, name: "公开处理工具", description: "", status: "enabled",
    revision: 2, publication: publicToolTestPublication(), createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z" });
}
export function publicToolTestCall() {
  return PublicToolStoredCall.parse({ callId: PUBLIC_TOOL_TEST_IDS.call, toolId: PUBLIC_TOOL_TEST_IDS.tool,
    requestId: PUBLIC_TOOL_TEST_IDS.request, origin: "public-agent-tool", publication: publicToolTestPublication(),
    requestHash: "a".repeat(64), runId: null, receivedAt: "2026-10-12T00:00:00.000Z" });
}
