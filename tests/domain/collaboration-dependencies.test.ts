import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import {
  activeVersionDependingOnAgent,
  activeVersionDependingOnKnowledgeSource,
  inspectCollaborationVersionGraph,
  liveRunDependingOnAgent,
  liveRunDependingOnKnowledgeSource,
  type CollaborationVersionDependency,
} from "@/server/domain/runtime/collaboration-dependencies";

function manifest(agentId: string, versionId?: string, knowledgeSnapshot: string[] = []): AgentManifest {
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
    knowledgeSnapshot,
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

  it("发布前识别深层缺失版本与循环调用", () => {
    const valid = [
      version({ versionId: "version-b", agentId: "agent-b", agentName: "协作助手", manifest: manifest("agent-c", "version-c") }),
      version({ versionId: "version-c", agentId: "agent-c", agentName: "资料助手" }),
    ];
    expect(inspectCollaborationVersionGraph({
      rootAgentId: "agent-a",
      directKeys: ["agent-b:version-b"],
      versions: valid,
    })).toEqual({
      issue: null,
      agentIds: ["agent-b", "agent-c"],
      versionIds: ["version-b", "version-c"],
      knowledgeSourceIds: [],
    });

    expect(inspectCollaborationVersionGraph({
      rootAgentId: "agent-a",
      directKeys: ["agent-b:version-b"],
      versions: valid.slice(0, 1),
    }).issue).toContain("缺失");

    const cyclic = [
      version({ versionId: "version-b", agentId: "agent-b", agentName: "协作助手", manifest: manifest("agent-a", "version-a") }),
    ];
    expect(inspectCollaborationVersionGraph({
      rootAgentId: "agent-a",
      directKeys: ["agent-b:version-b"],
      versions: cyclic,
    }).issue).toContain("循环");
  });

  it("发布前阻止超过运行时上限的深层协作链", () => {
    const versions = Array.from({ length: 6 }, (_, index) => version({
      versionId: `version-${index + 1}`,
      agentId: `agent-${index + 1}`,
      agentName: `助手 ${index + 1}`,
      manifest: index === 5 ? manifest("", undefined) : manifest(`agent-${index + 2}`, `version-${index + 2}`),
    }));
    expect(inspectCollaborationVersionGraph({
      rootAgentId: "root-agent",
      directKeys: ["agent-1:version-1"],
      versions,
    }).issue).toContain("5 层");
  });

  it("识别在线版本经历史协作版本间接使用的知识资料", () => {
    const sourceId = "00000000-0000-4000-8000-0000000000a1";
    const versions = [
      version({ versionId: "version-a", agentId: "agent-a", agentName: "客户助手", status: "production", manifest: manifest("agent-b", "version-b") }),
      version({ versionId: "version-b", agentId: "agent-b", agentName: "研究助手", manifest: manifest("", undefined, [sourceId]) }),
    ];

    expect(activeVersionDependingOnKnowledgeSource(versions, sourceId)).toEqual({ agentId: "agent-a", agentName: "客户助手" });
    expect(inspectCollaborationVersionGraph({
      rootAgentId: "agent-a",
      directKeys: ["agent-b:version-b"],
      versions,
    }).knowledgeSourceIds).toEqual([sourceId]);
  });

  it("识别进行中运行使用的已退役版本依赖", () => {
    const sourceId = "00000000-0000-4000-8000-0000000000a2";
    const versions = [
      version({ versionId: "retired-root", agentId: "agent-a", agentName: "运行中的旧助手", manifest: manifest("agent-b", "retired-child") }),
      version({ versionId: "retired-child", agentId: "agent-b", agentName: "旧协作助手", agentArchivedAt: new Date(), manifest: manifest("agent-c", "target-version", [sourceId]) }),
      version({ versionId: "target-version", agentId: "agent-c", agentName: "目标助手", agentArchivedAt: new Date() }),
    ];
    const liveRoots = new Set(["retired-root"]);

    expect(liveRunDependingOnAgent(versions, liveRoots, "agent-c"))
      .toEqual({ agentId: "agent-a", agentName: "运行中的旧助手" });
    expect(liveRunDependingOnKnowledgeSource(versions, liveRoots, sourceId))
      .toEqual({ agentId: "agent-a", agentName: "运行中的旧助手" });
  });

  it("不把无关运行或运行根助手自身当作协作依赖", () => {
    const versions = [
      version({ versionId: "root-a", agentId: "agent-a", agentName: "助手 A", manifest: manifest("agent-b", "version-b") }),
      version({ versionId: "version-b", agentId: "agent-b", agentName: "助手 B" }),
    ];

    expect(liveRunDependingOnAgent(versions, new Set(["other-version"]), "agent-b")).toBeNull();
    expect(liveRunDependingOnAgent(versions, new Set(["root-a"]), "agent-a")).toBeNull();
    expect(liveRunDependingOnKnowledgeSource(versions, new Set(["other-version"]), "missing-source")).toBeNull();
  });
});
