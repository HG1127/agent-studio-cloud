import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agentVersions, agents, evaluationRuns } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { restoreVersionAction } from "@/server/actions/restore-version";
import { workflowFingerprint } from "@/server/domain/pipeline";

const AGENT_ID = "00000000-0000-4000-8000-0000000000d1";
const CURRENT_ID = "00000000-0000-4000-8000-0000000000d2";
const SOURCE_ID = "00000000-0000-4000-8000-0000000000d3";
const CROSS_VERSION_ID = "00000000-0000-4000-8000-0000000000d4";
const PENDING_ID = "00000000-0000-4000-8000-0000000000d5";
const OTHER_WS = "00000000-0000-4000-8000-0000000000df";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "restore-test",
  workflowSnapshot: {
    id: "workflow",
    versionId: null,
    startNodeId: "start",
    rootAgent: { id: "agent", name: "恢复测试助手", role: "owner" },
    nodes: {
      start: { id: "start", title: "收到恢复请求", type: "trigger", next: "work", requirementIds: [], businessSpec: null },
      work: {
        id: "work",
        title: "生成恢复结果",
        type: "ai",
        purpose: "根据输入生成恢复结果",
        modelClass: "default",
        next: "deliver",
        requirementIds: [],
        businessSpec: {
          grounding: { status: "strong", score: 1 },
          doneWhen: ["result 字段已经生成"],
          evidence: ["用户要求生成恢复结果"],
        },
      },
      deliver: {
        id: "deliver",
        title: "整理最终结果",
        type: "system",
        next: "end",
        system: { kind: "deliver_output" },
        description: "整理本次运行中已形成的业务结果",
        controlPlane: { kind: "delivery", hiddenByDefault: true },
        ui: { visibility: "control" },
      },
      end: { id: "end", title: "结束", type: "end", next: null, requirementIds: [], businessSpec: null },
    },
    variables: [],
    memoryPolicy: { taskContext: true, longTerm: false },
    outputContract: { fields: [{ path: "result", label: "恢复结果", required: true, sourceNodeId: "work" }] },
    ui: { positions: {} },
  },
  inputContract: { fields: [] },
  outputContract: { fields: [{ path: "result", label: "恢复结果", required: true, sourceNodeId: "work" }] },
  resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  knowledgeSnapshot: [],
});

afterEach(async () => {
  await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertVersions(
  sourceStatus: "candidate" | "superseded" | "retired",
  sourceManifest = manifest,
) {
  await db.insert(agents).values({
    id: AGENT_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    name: "恢复测试助手",
    intentText: "验证历史版本恢复边界",
  });
  await db.insert(agentVersions).values([
    {
      id: CURRENT_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 2,
      status: "production",
      manifest,
    },
    {
      id: SOURCE_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 1,
      status: sourceStatus,
      manifest: sourceManifest,
    },
  ]);
}

describe("恢复历史版本", () => {
  it("不能把待验收版本直接恢复为当前版本", async () => {
    await insertVersions("candidate");

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({ ok: false, error: "只有曾经上线的历史版本才能恢复为当前版本" });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("自动验收运行期间不能恢复历史版本", async () => {
    await insertVersions("retired");
    await db.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: CURRENT_ID,
      status: "running",
      totalCount: 1,
    });

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "自动验收运行期间不能恢复历史版本，请等待验收完成",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("恢复已退役版本时创建新的正式版本并退役原当前版本", async () => {
    await insertVersions("retired");
    await db.insert(agentVersions).values({
      id: PENDING_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 3,
      status: "candidate",
      manifest,
    });
    await db.insert(agentVersions).values({
      id: CROSS_VERSION_ID,
      agentId: AGENT_ID,
      workspaceId: OTHER_WS,
      createdBy: DEMO_USER_ID,
      version: 99,
      status: "production",
      manifest,
    });

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toMatchObject({ version: 4, status: "production" });
    const [oldCurrent] = await db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.id, CURRENT_ID), eq(agentVersions.agentId, AGENT_ID)));
    expect(oldCurrent.status).toBe("retired");
    const [pending] = await db.select().from(agentVersions).where(eq(agentVersions.id, PENDING_ID));
    expect(pending.status).toBe("superseded");
    const [restored] = await db.select().from(agentVersions).where(eq(agentVersions.id, result.version.id));
    const [crossVersion] = await db.select().from(agentVersions).where(eq(agentVersions.id, CROSS_VERSION_ID));
    expect(crossVersion.status).toBe("production");
    expect(restored.manifest.workflowSnapshot.rootAgent).toMatchObject({
      id: AGENT_ID,
      name: "恢复测试助手",
      role: "owner",
    });
    const restoredManifest = AgentManifest.parse(restored.manifest);
    expect(restoredManifest.workflowFingerprint).toBe(workflowFingerprint(restoredManifest.workflowSnapshot));
    expect(restoredManifest.designAudit.criticalCount).toBe(0);
  });

  it("重复恢复同一个历史版本时复用刚创建的正式版本", async () => {
    await insertVersions("retired");

    const first = await restoreVersionAction(AGENT_ID, SOURCE_ID);
    const second = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(3);
  });

  it("知识快照已经不可用时不会替换当前版本", async () => {
    const missingSourceId = "00000000-0000-4000-8000-0000000000e1";
    const knowledgeManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-knowledge-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          start: { ...manifest.workflowSnapshot.nodes.start, next: "knowledge" },
          knowledge: {
            id: "knowledge",
            title: "查询业务资料",
            type: "knowledge",
            next: "work",
            knowledge: { space: "业务资料库", sourceIds: [missingSourceId] },
            businessSpec: {
              grounding: { status: "strong", score: 1 },
              doneWhen: ["资料检索结果已经写入步骤输出"],
              evidence: ["用户要求查询业务资料"],
            },
          },
        },
      },
      knowledgeSnapshot: [missingSourceId],
    });
    await insertVersions("retired", knowledgeManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("需要知识资料");
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("业务工具已经不可用时不会替换当前版本", async () => {
    const toolManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-tool-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          start: { ...manifest.workflowSnapshot.nodes.start, next: "tool" },
          tool: {
            id: "tool",
            title: "更新客户",
            type: "tool",
            next: "work",
            tool: {
              connector: "客户系统",
              action: "update_customer",
              scope: "customer.write",
              risk: "medium",
              registryToolId: "missing.tool",
              protocol: "http-json",
            },
            businessSpec: {
              grounding: { status: "strong", score: 1 },
              doneWhen: ["客户系统回执已经返回"],
              evidence: ["用户要求更新客户"],
            },
          },
        },
      },
    });
    await insertVersions("retired", toolManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "步骤「更新客户」绑定的业务工具未在服务端配置，无法恢复这个历史版本",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("执行路径已经不符合当前运行规则时不会替换当前版本", async () => {
    const brokenManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-route-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          start: { ...manifest.workflowSnapshot.nodes.start, next: "missing" },
        },
      },
    });
    await insertVersions("retired", brokenManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "步骤“开始”的正常路径指向了不存在的步骤，无法恢复这个历史版本",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("设计已经不符合当前发布检查时不会替换当前版本", async () => {
    const brokenManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-design-gate-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        outputContract: { fields: [] },
      },
      outputContract: { fields: [] },
    });
    await insertVersions("retired", brokenManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "历史版本不再符合当前发布检查：没有定义最终交付物",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("协作助手已经不可用时不会替换当前版本", async () => {
    const missingAgentId = "00000000-0000-4000-8000-0000000000e2";
    const missingVersionId = "00000000-0000-4000-8000-0000000000e3";
    const collaborationManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-collaboration-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          start: { ...manifest.workflowSnapshot.nodes.start, next: "call" },
          call: {
            id: "call",
            title: "请协作助手处理",
            type: "agent_call",
            next: "work",
            agentCall: { targetAgentId: missingAgentId, versionId: missingVersionId },
            businessSpec: {
              grounding: { status: "strong", score: 1 },
              doneWhen: ["协作助手结果已经返回"],
              evidence: ["用户要求协作处理"],
            },
          },
        },
      },
    });
    await insertVersions("retired", collaborationManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "协作链包含已停用、缺失或格式不完整的冻结版本，无法恢复这个历史版本",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });
});
