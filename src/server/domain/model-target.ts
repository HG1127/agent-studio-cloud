// 运行模型目标裁定：manifest 冻结值 → mock / 连接 / 环境变量，三者择一。
// 异常一律抛中文 Error（会直接进入运行错误上界面），不静默回落 mock。
import { decryptApiKey } from "@/server/domain/crypto";

export interface ModelManifestRef {
  connectionId: string | null;
  modelId: string;
  mock: boolean;
}
export interface ModelConnectionRef {
  id: string;
  baseUrl: string;
  apiKeyCiphertext: string;
  modelIds: string[];
}
export type ModelTarget =
  | { kind: "mock" }
  | { kind: "env"; baseUrl: string; apiKey: string; modelId: string }
  | { kind: "connection"; connectionId: string; baseUrl: string; apiKey: string; modelId: string };

export function resolveModelTarget(args: {
  manifestModel: ModelManifestRef;
  connection: ModelConnectionRef | null;
  encryptionKey: Buffer | null;
  envModel: { baseUrl: string | null; apiKey: string | null; modelId: string | null };
}): ModelTarget {
  const { manifestModel, connection, encryptionKey, envModel } = args;
  if (manifestModel.mock) return { kind: "mock" };
  if (manifestModel.connectionId) {
    if (!connection) throw new Error("版本选用的模型连接已被删除，请重新选择模型后再次发布");
    if (!connection.modelIds.includes(manifestModel.modelId)) {
      throw new Error("版本选用的模型已不在该连接的模型列表里，请重新选择模型后再次发布");
    }
    if (!encryptionKey) throw new Error("服务端缺少密钥解密配置，无法使用已保存的模型连接");
    let apiKey: string;
    try {
      apiKey = decryptApiKey(connection.apiKeyCiphertext, encryptionKey);
    } catch {
      throw new Error("模型密钥解密失败，请检查服务端密钥配置");
    }
    return { kind: "connection", connectionId: connection.id, baseUrl: connection.baseUrl, apiKey, modelId: manifestModel.modelId };
  }
  if (envModel.baseUrl && envModel.apiKey && envModel.modelId) {
    return { kind: "env", baseUrl: envModel.baseUrl, apiKey: envModel.apiKey, modelId: envModel.modelId };
  }
  throw new Error("模型尚未配置，请先在设置页接入模型服务后再运行");
}
