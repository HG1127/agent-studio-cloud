import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  workspaceId: crypto.randomUUID(),
  otherWorkspaceId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  agentId: crypto.randomUUID(),
  runId: crypto.randomUUID(),
  ownConnectionId: crypto.randomUUID(),
  otherConnectionId: crypto.randomUUID(),
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({ generateText: fixture.generateText }));
vi.mock("@/server/model/recorded-run-model", () => ({ recordRunModel: (model: unknown) => model }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: vi.fn() }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: vi.fn() }));

import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { agents, modelConnections, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { encryptApiKey } from "@/server/domain/crypto";
import { runModelStep } from "@/server/steps/model-step";

const node = WorkflowNode.parse({ id: "analyze", title: "分析业务输入", type: "ai", next: "done" });
const key = "9".repeat(64);

function manifestFor(connectionId: string) {
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowFingerprint: "test-fingerprint",
    workflowSnapshot: {
      id: "workspace-test",
      rootAgent: { id: fixture.agentId, name: "测试助手", role: "助手" },
      nodes: { analyze: node },
      memoryPolicy: { taskContext: true, longTerm: false },
    },
    resourceSelection: { model: { modelId: "test-model", mock: false, connectionId } },
    inputContract: { fields: [] },
    outputContract: { fields: [] },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  });
}

beforeAll(async () => {
  const apiKeyCiphertext = encryptApiKey("sk-workspace-test", Buffer.from(key, "hex"));
  await db.insert(agents).values({
    id: fixture.agentId, workspaceId: fixture.workspaceId, createdBy: fixture.userId,
    name: "模型工作区测试助手", intentText: "验证模型步骤不会使用其他工作区的密钥", status: "draft",
  });
  await db.insert(runs).values({
    id: fixture.runId, workspaceId: fixture.workspaceId, createdBy: fixture.userId,
    agentId: fixture.agentId, versionId: fixture.agentId, status: "running", input: {},
  });
  await db.insert(modelConnections).values([
    {
      id: fixture.ownConnectionId, workspaceId: fixture.workspaceId, createdBy: fixture.userId,
      name: "本工作区连接", baseUrl: "https://model.example.com/v1", apiKeyCiphertext,
      apiKeyHint: "****test", modelIds: ["test-model"],
    },
    {
      id: fixture.otherConnectionId, workspaceId: fixture.otherWorkspaceId, createdBy: fixture.userId,
      name: "其他工作区连接", baseUrl: "https://model.example.com/v1", apiKeyCiphertext,
      apiKeyHint: "****test", modelIds: ["test-model"],
    },
  ]);
});

beforeEach(() => {
  vi.stubEnv("MODEL_ENCRYPTION_KEY", key);
  vi.stubEnv("REAL_MODELS_ENABLED", "1");
  fixture.generateText.mockReset().mockResolvedValue({ text: "工作区内模型答复", usage: {} });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await db.delete(modelConnections).where(inArray(modelConnections.id, [fixture.ownConnectionId, fixture.otherConnectionId]));
  await db.delete(runs).where(eq(runs.id, fixture.runId));
  await db.delete(agents).where(eq(agents.id, fixture.agentId));
});

describe("运行模型连接工作区隔离", () => {
  it("允许使用运行所属工作区的连接", async () => {
    await expect(runModelStep({
      runId: fixture.runId, node, manifest: manifestFor(fixture.ownConnectionId), outputs: {}, input: {},
    })).resolves.toEqual({ output: "工作区内模型答复" });
    expect(fixture.generateText).toHaveBeenCalledOnce();
  });

  it("不读取其他工作区的连接或调用模型", async () => {
    await expect(runModelStep({
      runId: fixture.runId, node, manifest: manifestFor(fixture.otherConnectionId), outputs: {}, input: {},
    })).rejects.toThrow("版本选用的模型连接已被删除");
    expect(fixture.generateText).not.toHaveBeenCalled();
  });
});
