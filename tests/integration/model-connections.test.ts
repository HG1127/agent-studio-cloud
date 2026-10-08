import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  workspaceId: crypto.randomUUID(),
  otherWorkspaceId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  generateText: vi.fn(),
  provider: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/constants", () => ({ DEMO_WORKSPACE_ID: fixture.workspaceId, DEMO_USER_ID: fixture.userId }));
vi.mock("next/cache", () => ({ revalidatePath: fixture.revalidatePath }));
vi.mock("ai", () => ({ generateText: fixture.generateText }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: fixture.provider }));

import { ModelConnectionView } from "@/contracts/connections";
import { modelConnections } from "@/db/schema";
import { db } from "@/lib/db";
import { decryptApiKey } from "@/server/domain/crypto";
import { deleteModelConnectionAction, saveModelConnectionAction, testModelConnectionAction } from "@/server/actions/model-connections";
import { listModelConnections } from "@/server/queries/model-connections";

const input = {
  name: "集成测试连接",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-integration-000000",
  modelIds: ["test-a", "test-b"],
  isDefaultCompile: false,
};

beforeEach(() => {
  vi.stubEnv("MODEL_ENCRYPTION_KEY", "9".repeat(64));
  fixture.generateText.mockReset().mockResolvedValue({ text: " pong " });
  fixture.provider.mockReset().mockImplementation(() => (modelId: string) => ({ modelId }));
  fixture.revalidatePath.mockReset();
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await db.delete(modelConnections).where(inArray(modelConnections.workspaceId, [fixture.workspaceId, fixture.otherWorkspaceId]));
}, 60_000);

async function save(overrides: Record<string, unknown> = {}) {
  const result = await saveModelConnectionAction({ ...input, ...overrides });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.id;
}

async function getRow(id: string) {
  const [row] = await db.select().from(modelConnections).where(eq(modelConnections.id, id));
  return row;
}

describe("模型连接管理", () => {
  it("保存时只存密文和掩码，解密可还原调用密钥", async () => {
    const id = await save();
    const row = await getRow(id);
    expect(row.apiKeyCiphertext).not.toContain(input.apiKey);
    expect(row.apiKeyHint).toBe("****0000");
    expect(decryptApiKey(row.apiKeyCiphertext, Buffer.from("9".repeat(64), "hex"))).toBe(input.apiKey);
    expect(row.workspaceId).toBe(fixture.workspaceId);
  });

  it("设为默认后旧默认被取消，并发保存也只能有一个默认", async () => {
    const first = await save({ isDefaultCompile: true });
    const second = await save({ isDefaultCompile: true });
    expect((await getRow(first)).isDefaultCompile).toBe(false);
    expect((await getRow(second)).isDefaultCompile).toBe(true);
    const ids = await Promise.all([save({ isDefaultCompile: true }), save({ isDefaultCompile: true })]);
    const defaults = await db.select().from(modelConnections).where(and(
      eq(modelConnections.workspaceId, fixture.workspaceId),
      eq(modelConnections.isDefaultCompile, true),
      isNull(modelConnections.archivedAt),
    ));
    expect(defaults).toHaveLength(1);
    expect(ids).toContain(defaults[0].id);
  });

  it("非法输入和缺少加密配置时不写入连接", async () => {
    const before = await listModelConnections();
    for (const overrides of [{ apiKey: "short" }, { modelIds: [] }, { baseUrl: "not-a-url" }]) {
      expect((await saveModelConnectionAction({ ...input, ...overrides })).ok).toBe(false);
    }
    vi.stubEnv("MODEL_ENCRYPTION_KEY", "");
    expect((await saveModelConnectionAction(input)).ok).toBe(false);
    expect(await listModelConnections()).toHaveLength(before.length);
  });

  it("编辑名称和模型列表时，空密钥保留原密文", async () => {
    const id = await save();
    const original = await getRow(id);
    expect(await save({ id, name: "编辑后的连接", modelIds: ["test-c"], apiKey: "" })).toBe(id);
    const updated = await getRow(id);
    expect(updated).toMatchObject({ name: "编辑后的连接", modelIds: ["test-c"], apiKeyCiphertext: original.apiKeyCiphertext });
  });

  it("编辑时填写新密钥会替换密文和掩码", async () => {
    const id = await save();
    await save({ id, apiKey: "sk-replacement-1234" });
    const row = await getRow(id);
    expect(row.apiKeyHint).toBe("****1234");
    expect(decryptApiKey(row.apiKeyCiphertext, Buffer.from("9".repeat(64), "hex"))).toBe("sk-replacement-1234");
  });

  it("更换服务地址必须同时提供新密钥", async () => {
    const id = await save();
    const original = await getRow(id);
    const rejected = await saveModelConnectionAction({ ...input, id, baseUrl: "https://other.example.com/v1", apiKey: "" });
    expect(rejected).toEqual({ ok: false, error: "更改服务地址时，请重新填写密钥" });
    expect(await getRow(id)).toMatchObject({ baseUrl: original.baseUrl, apiKeyCiphertext: original.apiKeyCiphertext });
    await save({ id, baseUrl: "https://other.example.com/v1", apiKey: "sk-new-endpoint-1234" });
    expect((await getRow(id)).baseUrl).toBe("https://other.example.com/v1");
  });

  it("生产未开放真实模型时拒绝连接操作", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REAL_MODELS_ENABLED", "");
    expect(await saveModelConnectionAction(input)).toEqual({ ok: false, error: "真实模型功能尚未开放" });
    expect(await listModelConnections()).toEqual([]);
    expect(await testModelConnectionAction(crypto.randomUUID())).toEqual({ ok: false, error: "真实模型功能尚未开放" });
    expect(await deleteModelConnectionAction(crypto.randomUUID())).toEqual({ ok: false, error: "真实模型功能尚未开放" });
    expect(fixture.generateText).not.toHaveBeenCalled();
  });

  it("列表只返回视图字段，不返回明文或密文", async () => {
    const id = await save();
    const view = (await listModelConnections()).find((item) => item.id === id);
    expect(view).toBeDefined();
    expect(Object.keys(view!).sort()).toEqual(Object.keys(ModelConnectionView.shape).sort());
    expect(view?.apiKeyHint).toBe("****0000");
    expect(JSON.stringify(view)).not.toContain(input.apiKey);
  });

  it("测试连通使用保存的地址、解密密钥和首个模型", async () => {
    const id = await save();
    expect(await testModelConnectionAction(id)).toEqual({ ok: true, reply: "pong" });
    expect(fixture.provider).toHaveBeenCalledWith(expect.objectContaining({ baseURL: input.baseUrl, apiKey: input.apiKey }));
    expect(fixture.generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: { modelId: "test-a" }, prompt: "请只回复：pong", abortSignal: expect.any(AbortSignal), maxRetries: 0,
    }));
  });

  it.each([401, 404, 429, 503])("连接失败 %s 返回中文诊断，不暴露供应商错误中的密钥", async (statusCode) => {
    const id = await save();
    fixture.generateText.mockRejectedValue(Object.assign(new Error(`upstream leaked ${input.apiKey}`), { statusCode }));
    const result = await testModelConnectionAction(id);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(input.apiKey);
    if (!result.ok) expect(result.error).toMatch(statusCode >= 429 ? /超时|暂时|稍后/ : /地址|密钥|模型/);
  });

  it("主密钥错误时不发起模型调用", async () => {
    const id = await save();
    vi.stubEnv("MODEL_ENCRYPTION_KEY", "8".repeat(64));
    const result = await testModelConnectionAction(id);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("解密失败") });
    expect(fixture.generateText).not.toHaveBeenCalled();
  });

  it("删除是软删除，已删除连接不允许测试或编辑", async () => {
    const id = await save({ isDefaultCompile: true });
    expect(await deleteModelConnectionAction(id)).toEqual({ ok: true });
    expect((await listModelConnections()).find((row) => row.id === id)).toBeUndefined();
    expect(await getRow(id)).toMatchObject({ archivedAt: expect.any(Date), isDefaultCompile: false });
    expect((await testModelConnectionAction(id)).ok).toBe(false);
    expect((await saveModelConnectionAction({ ...input, id })).ok).toBe(false);
  });

  it("保存或删除已提交后缓存刷新失败仍返回成功", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      fixture.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });
      const id = await save();
      expect(await getRow(id)).toMatchObject({ name: input.name, archivedAt: null });
      fixture.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });
      expect(await deleteModelConnectionAction(id)).toEqual({ ok: true });
      expect((await getRow(id)).archivedAt).toBeInstanceOf(Date);
      expect(fixture.revalidatePath).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it("不能查询、编辑、删除或测试其他工作区的连接", async () => {
    const id = await save();
    await db.update(modelConnections).set({ workspaceId: fixture.otherWorkspaceId }).where(eq(modelConnections.id, id));
    expect((await listModelConnections()).find((row) => row.id === id)).toBeUndefined();
    expect((await saveModelConnectionAction({ ...input, id })).ok).toBe(false);
    expect((await deleteModelConnectionAction(id)).ok).toBe(false);
    expect((await testModelConnectionAction(id)).ok).toBe(false);
    expect((await getRow(id)).archivedAt).toBeNull();
    expect(fixture.generateText).not.toHaveBeenCalled();
  });
});
