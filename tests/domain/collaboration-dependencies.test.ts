import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import {
  activeVersionDependingOnAgent,
  type CollaborationVersionDependency,
} from "@/server/domain/runtime/collaboration-dependencies";

function manifest(agentId: string, versionId?: string): AgentManifest {
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowSnapshot: {
      id: "workflow",
      versionId: null,
      startNodeId: "start",
      rootAgent: { id: "root", name: "助手", role: "处理" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: versionId ? "call" : "done" },
        ...(versionId ? {
          call: {
            id: "call", title: "协作", type: "agent_call" as const, next: "done",
            agentCall: { targetAgentId: agentId, versionId },
          },
        } : {}),
        done: { id: "done", title: "完成", type: "end", next: null },
      },
      variables: [],
      memoryPolicy: { taskContext: true, longTerm: false },
      ui: { positions: {} },
    },
    workflowFingerprint: "fingerprint",
    inputContract: { fields: [] },
    outputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    knowledgeSnapshot: [],
  });
}

function version(args: Partial<CollaborationVersionDependency> & Pick<CollaborationVersionDependency, "versionId" | "agentId" | "agentName">): CollaborationVersionDependency {
  return {
    status: "retired",
    agentArchivedAt: null,
    manifest: manifest("", undefined),
    ...args,
  };
}

describe("在线版本的传递协作依赖", () => {
  it("识别通过历史冻结版本形成的间接依赖", () => {
    const versions = [
      version({ versionId: "version-a", agentId: "agent-a", agentName: "客户助手", status: "production", manifest: manifest("agent-b", "version-b") }),
      version({ versionId: "version-b", agentId: "agent-b", agentName: "研究助手", manifest: manifest("agent-c", "version-c") }),
      version({ versionId: "version-c", agentId: "agent-c", agentName: "资料助手" }),
    ];

    expect(activeVersionDependingOnAgent(versions, "agent-c")).toEqual({ agentId: "agent-a", agentName: "客户助手" });
  });

  it("不会把不在线版本或已停用的中间助手算作有效依赖链", () => {
    const retiredRoot = version({ versionId: "version-a", agentId: "agent-a", agentName: "旧助手", manifest: manifest("agent-c", "version-c") });
    const archivedMiddle = version({
      versionId: "version-b", agentId: "agent-b", agentName: "已停用助手", agentArchivedAt: new Date(), manifest: manifest("agent-c", "version-c"),
    });
    const activeRoot = version({ versionId: "version-live", agentId: "agent-live", agentName: "在线助手", status: "production", manifest: manifest("agent-b", "version-b") });

    expect(activeVersionDependingOnAgent([retiredRoot, archivedMiddle, activeRoot], "agent-c")).toBeNull();
  });

  it("循环依赖不会导致遍历失控", () => {
    const versions = [
      version({ versionId: "version-a", agentId: "agent-a", agentName: "在线助手", status: "candidate", manifest: manifest("agent-b", "version-b") }),
      version({ versionId: "version-b", agentId: "agent-b", agentName: "协作助手", manifest: manifest("agent-a", "version-a") }),
    ];

    expect(activeVersionDependingOnAgent(versions, "agent-c")).toBeNull();
  });
});
