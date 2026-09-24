import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  workspaceId: crypto.randomUUID(), otherWorkspaceId: crypto.randomUUID(), userId: crypto.randomUUID(),
  generateText: vi.fn(), provider: vi.fn(),
}));
vi.mock("@/lib/constants", () => ({ DEMO_WORKSPACE_ID: fixture.workspaceId, DEMO_USER_ID: fixture.userId }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("ai", () => ({ generateText: fixture.generateText }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: fixture.provider }));

import { agents, modelConnections, workflowDefinitions } from "@/db/schema";
import { db } from "@/lib/db";
import { encryptApiKey } from "@/server/domain/crypto";
import { createAgentAction } from "@/server/actions/create-agent";

const input = { name: "模型编排验收助手", intentText: "请分析客户反馈内容，归纳问题并生成一份处理建议报告" };
const modelReply = JSON.stringify({ steps: [
  { kind: "model", title: "分析客户关注点" },
  { kind: "model", title: "整理处理建议" },
] });
const key = Buffer.from("7".repeat(64), "hex");

beforeEach(async () => {
  for (const name of ["MODEL_BASE_URL", "MODEL_API_KEY", "MODEL_ID", "LLM_COMPILE"]) vi.stubEnv(name, "");
  vi.stubEnv("MODEL_MOCK", "1");
  vi.stubEnv("MODEL_ENCRYPTION_KEY", key.toString("hex"));
  fixture.generateText.mockReset().mockResolvedValue({ text: modelReply });
  fixture.provider.mockReset().mockImplementation(() => (modelId: string) => ({ modelId }));
  await db.update(modelConnections).set({ isDefaultCompile: false }).where(eq(modelConnections.workspaceId, fixture.workspaceId));
}, 60_000);
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  await db.delete(workflowDefinitions).where(eq(workflowDefinitions.workspaceId, fixture.workspaceId));
  await db.delete(agents).where(eq(agents.workspaceId, fixture.workspaceId));
  await db.delete(modelConnections).where(inArray(modelConnections.workspaceId, [fixture.workspaceId, fixture.otherWorkspaceId]));
}, 60_000);

async function saveDefault(overrides: Partial<typeof modelConnections.$inferInsert> = {}) {
  await db.insert(modelConnections).values({
    workspaceId: fixture.workspaceId, createdBy: fixture.userId,
    name: "默认编译连接", baseUrl: "https://compile.example.com/v1",
    apiKeyCiphertext: encryptApiKey("sk-compile-not-real", key), apiKeyHint: "****real",
    modelIds: ["compile-first", "compile-second"], isDefaultCompile: true, ...overrides,
  });
}
function configureEnvironment() {
  vi.stubEnv("MODEL_MOCK", "0");
  vi.stubEnv("MODEL_BASE_URL", "https://env.example.com/v1");
  vi.stubEnv("MODEL_API_KEY", "sk-env-not-real");
  vi.stubEnv("MODEL_ID", "env-model");
}
async function createDraft() {
  const result = await createAgentAction(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.agentId, result.agentId));
  expect(row.workspaceId).toBe(fixture.workspaceId);
  return row.draft;
}

describe("创建助手模型编译", () => {
  it("默认连接优先于环境模型，首模型生成的草稿经审计后持久化", async () => {
    configureEnvironment();
    await saveDefault();
    const draft = await createDraft();
    expect(draft.intentSource?.compiler).toBe("llm");
    expect(draft.nodes.step_1.title).toBe("分析客户关注点");
    expect(draft.businessGrounding).toBeTruthy();
    expect(fixture.provider).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://compile.example.com/v1", apiKey: "sk-compile-not-real" }));
    expect(fixture.generateText).toHaveBeenCalledWith(expect.objectContaining({ model: { modelId: "compile-first" }, abortSignal: expect.any(AbortSignal), maxRetries: 0 }));
  });

  it("演示运行开关不屏蔽用户指定的默认编译连接", async () => {
    await saveDefault();
    expect((await createDraft()).intentSource?.compiler).toBe("llm");
  });

  it("无默认连接时使用环境模型", async () => {
    configureEnvironment();
    expect((await createDraft()).intentSource?.compiler).toBe("llm");
    expect(fixture.generateText).toHaveBeenCalledWith(expect.objectContaining({ model: { modelId: "env-model" } }));
  });

  it("显式关闭时不调用模型且保留原规则草稿", async () => {
    await saveDefault();
    vi.stubEnv("LLM_COMPILE", "0");
    expect((await createDraft()).intentSource?.mode).toBe("semantic-graph-v3.6");
    expect(fixture.generateText).not.toHaveBeenCalled();
  });

  it("无可用模型时正常创建规则草稿", async () => {
    expect((await createDraft()).intentSource?.mode).toBe("semantic-graph-v3.6");
    expect(fixture.generateText).not.toHaveBeenCalled();
  });

  it.each(["不是合法 JSON", '{"steps":[{"kind":"tool","title":"缺少目标"},{"kind":"model","title":"完成"}]}'])("模型回复不合法时回退：%s", async (text) => {
    await saveDefault();
    fixture.generateText.mockResolvedValue({ text });
    expect((await createDraft()).intentSource?.mode).toBe("semantic-graph-v3.6");
    expect(fixture.generateText).toHaveBeenCalledOnce();
  });

  it("模型超时或失败不阻断创建，也不把原始异常密钥写日志", async () => {
    await saveDefault();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fixture.generateText.mockRejectedValue(new Error("timeout: sk-compile-not-real"));
    expect((await createDraft()).intentSource?.mode).toBe("semantic-graph-v3.6");
    expect(fixture.generateText).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sk-compile-not-real");
  });

  it("默认连接无法解密时使用环境模型", async () => {
    configureEnvironment();
    await saveDefault();
    vi.stubEnv("MODEL_ENCRYPTION_KEY", "8".repeat(64));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await createDraft()).intentSource?.compiler).toBe("llm");
    expect(fixture.generateText).toHaveBeenCalledWith(expect.objectContaining({ model: { modelId: "env-model" } }));
  });

  it("不使用其他工作区或已删除的默认连接", async () => {
    await saveDefault({ workspaceId: fixture.otherWorkspaceId });
    await saveDefault({ archivedAt: new Date() });
    expect((await createDraft()).intentSource?.mode).toBe("semantic-graph-v3.6");
    expect(fixture.generateText).not.toHaveBeenCalled();
  });

  it("可选的模型查询失败仍可保存规则草稿", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookup = vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("模拟模型查询失败"); });
    const result = await createAgentAction(input);
    expect(lookup).toHaveBeenCalledOnce();
    lookup.mockRestore();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const [row] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.agentId, result.agentId));
    expect(row.draft.intentSource?.mode).toBe("semantic-graph-v3.6");
  });
});
