"use server";

import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ModelConnectionSaveInput } from "@/contracts/connections";
import { modelConnections } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { isTransientModelError, realModelsEnabled } from "@/lib/model";
import { apiKeyHint, decryptApiKey, encryptApiKey, resolveEncryptionKey } from "@/server/domain/crypto";

class EndpointKeyRequiredError extends Error {}

export async function saveModelConnectionAction(input: unknown): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!realModelsEnabled()) return { ok: false, error: "真实模型功能尚未开放" };
  const parsed = ModelConnectionSaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "请检查连接名称、服务地址、密钥与模型列表的填写" };
  const key = resolveEncryptionKey(process.env.MODEL_ENCRYPTION_KEY);
  if (!key) return { ok: false, error: "当前服务缺少有效的模型加密主钥，请恢复原主钥并重启服务" };
  const { name, baseUrl, apiKey, modelIds, isDefaultCompile } = parsed.data;
  const connectionId = "id" in parsed.data ? parsed.data.id : null;
  try {
    const id = await db.transaction(async (tx) => {
      // 先清后设本身不能防住并发插入，按工作区串行化默认标记修改。
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${DEMO_WORKSPACE_ID}))`);
      if (connectionId) {
        const [existing] = await tx.select({ id: modelConnections.id, baseUrl: modelConnections.baseUrl }).from(modelConnections)
          .where(and(eq(modelConnections.id, connectionId), eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID), isNull(modelConnections.archivedAt)))
          .limit(1);
        if (!existing) return null;
        if (existing.baseUrl !== baseUrl && !apiKey) throw new EndpointKeyRequiredError();
      }
      if (isDefaultCompile) {
        await tx.update(modelConnections).set({ isDefaultCompile: false, updatedAt: new Date() })
          .where(and(eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID), eq(modelConnections.isDefaultCompile, true)));
      }
      const encrypted = apiKey ? { apiKeyCiphertext: encryptApiKey(apiKey, key), apiKeyHint: apiKeyHint(apiKey) } : undefined;
      if (connectionId) {
        const [updated] = await tx.update(modelConnections)
          .set({ name, baseUrl, modelIds, isDefaultCompile, ...encrypted, updatedAt: new Date() })
          .where(and(eq(modelConnections.id, connectionId), eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID), isNull(modelConnections.archivedAt)))
          .returning({ id: modelConnections.id });
        return updated?.id ?? null;
      }
      if (!encrypted) return null;
      const [created] = await tx.insert(modelConnections).values({
        workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name, baseUrl, modelIds, isDefaultCompile, ...encrypted,
      }).returning({ id: modelConnections.id });
      return created.id;
    });
    if (!id) return { ok: false, error: "连接不存在或已删除，请刷新页面后重试" };
    revalidatePath("/settings");
    return { ok: true, id };
  } catch (error) {
    if (error instanceof EndpointKeyRequiredError) return { ok: false, error: "更改服务地址时，请重新填写密钥" };
    return { ok: false, error: "保存连接失败，请稍后重试" };
  }
}

export async function deleteModelConnectionAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!realModelsEnabled()) return { ok: false, error: "真实模型功能尚未开放" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "连接标识不正确，请刷新页面后重试" };
  try {
    const [removed] = await db.update(modelConnections)
      .set({ archivedAt: new Date(), isDefaultCompile: false, updatedAt: new Date() })
      .where(and(eq(modelConnections.id, id), eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID), isNull(modelConnections.archivedAt)))
      .returning({ id: modelConnections.id });
    if (!removed) return { ok: false, error: "连接不存在或已删除，请刷新页面后重试" };
    revalidatePath("/settings");
    return { ok: true };
  } catch {
    return { ok: false, error: "删除连接失败，请稍后重试" };
  }
}

export async function testModelConnectionAction(id: string): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  if (!realModelsEnabled()) return { ok: false, error: "真实模型功能尚未开放" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "连接标识不正确，请刷新页面后重试" };
  try {
    const [connection] = await db.select().from(modelConnections)
      .where(and(eq(modelConnections.id, id), eq(modelConnections.workspaceId, DEMO_WORKSPACE_ID), isNull(modelConnections.archivedAt)))
      .limit(1);
    if (!connection) return { ok: false, error: "连接不存在或已删除，请刷新页面后重试" };
    const key = resolveEncryptionKey(process.env.MODEL_ENCRYPTION_KEY);
    if (!key) return { ok: false, error: "当前服务缺少有效的模型加密主钥，请恢复原主钥并重启服务" };
    let apiKey: string;
    try {
      apiKey = decryptApiKey(connection.apiKeyCiphertext, key);
    } catch {
      return { ok: false, error: "无法解开已保存的密钥，请先确认服务使用的是原加密主钥" };
    }
    const provider = createOpenAICompatible({ name: "custom-model", baseURL: connection.baseUrl, apiKey });
    const { text } = await generateText({
      model: provider(connection.modelIds[0]),
      system: "你是连通性测试助手。",
      prompt: "请只回复：pong",
      abortSignal: AbortSignal.timeout(15_000),
      maxRetries: 0,
    });
    return { ok: true, reply: text.trim().replaceAll(apiKey, "[已隐藏]").slice(0, 50) };
  } catch (error) {
    return { ok: false, error: isTransientModelError(error)
      ? "连接超时或服务暂时不可用，请稍后再试"
      : "测试失败，请检查接口地址、密钥和模型名称是否正确" };
  }
}
