// 模型接入与配置判定：env 只在服务端读取；MODEL_MOCK=1 时全部走确定性演示输出。
// 这里只放纯判定与 provider 单例，实际调用在 model-step（"use step"）里。
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

export function isModelMock(): boolean {
  return process.env.MODEL_MOCK === "1";
}

export function getModel() {
  const provider = createOpenAICompatible({
    name: "custom-model",
    baseURL: process.env.MODEL_BASE_URL ?? "",
    apiKey: process.env.MODEL_API_KEY ?? "",
  });
  return provider(process.env.MODEL_ID ?? "");
}

// 瞬时错误分类（移植旧系统 modelGateway.mjs 的 transientModelError 口径）：
// 429/5xx 与网络类文案可重试；4xx 配置类错误不重试
export function isTransientModelError(error: unknown): boolean {
  const status = Number((error as { statusCode?: unknown } | null)?.statusCode ?? 0);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /timeout|超时|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket/i.test(message);
}

export type PublishModelResolution =
  | { ok: true; modelId: string; mock: boolean }
  | { ok: false; error: string };

// 发布前模型配置守卫（T10 携带裁定）：真实模型必须有非空 MODEL_ID；
// 无 MODEL_ID 且未显式 MODEL_MOCK=1 时拒绝发布，不写入永久版本记录
export function resolvePublishModel(env: { modelId?: string; modelMock?: string }): PublishModelResolution {
  const modelId = (env.modelId ?? "").trim();
  if (!modelId && env.modelMock !== "1") {
    return { ok: false, error: "模型未配置：请先设置 MODEL_ID，或设置 MODEL_MOCK=1 使用演示模型后再发布" };
  }
  return { ok: true, modelId: modelId || "mock", mock: !modelId || env.modelMock === "1" };
}
