import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, resolveEncryptionKey } from "@/server/domain/crypto";
import { resolveModelTarget } from "@/server/domain/model-target";

const key = resolveEncryptionKey("1".repeat(64)) as Buffer;
const secret = "sk-live-00000000";
const connection = {
  id: "00000000-0000-4000-8000-0000000000c1",
  baseUrl: "https://api.example.com/v1",
  apiKeyCiphertext: encryptApiKey(secret, key),
  modelIds: ["gpt-a", "gpt-b"],
};

describe("resolveModelTarget", () => {
  const base = {
    encryptionKey: key,
    connection,
    envModel: { baseUrl: null, apiKey: null, modelId: null },
  };

  it("mock 冻结为演示输出，不看连接与环境变量", () => {
    expect(resolveModelTarget({ ...base, manifestModel: { connectionId: connection.id, modelId: "gpt-a", mock: true } })).toEqual({ kind: "mock" });
  });

  it("连接 + 模型在列表内 → 连接目标，密钥已解密", () => {
    const target = resolveModelTarget({ ...base, manifestModel: { connectionId: connection.id, modelId: "gpt-b", mock: false } });
    expect(target).toMatchObject({ kind: "connection", baseUrl: connection.baseUrl, apiKey: secret, modelId: "gpt-b" });
  });

  it("连接已被删除 → 抛错", () => {
    expect(() => resolveModelTarget({ ...base, connection: null, manifestModel: { connectionId: connection.id, modelId: "gpt-a", mock: false } })).toThrow(/已被删除/);
  });

  it("模型不在连接列表内 → 抛错", () => {
    expect(() => resolveModelTarget({ ...base, manifestModel: { connectionId: connection.id, modelId: "gpt-c", mock: false } })).toThrow(/模型列表/);
  });

  it("缺少解密主钥或解密失败 → 抛错且不透出主钥信息", () => {
    expect(() => resolveModelTarget({ ...base, encryptionKey: null, manifestModel: { connectionId: connection.id, modelId: "gpt-a", mock: false } })).toThrow(/解密/);
    const bad = { ...connection, apiKeyCiphertext: "00:00:00" };
    expect(() => resolveModelTarget({ ...base, connection: bad, manifestModel: { connectionId: connection.id, modelId: "gpt-a", mock: false } })).toThrow(/解密/);
  });

  it("无连接时回退环境变量模型", () => {
    const target = resolveModelTarget({
      ...base,
      manifestModel: { connectionId: null, modelId: "mock", mock: false },
      envModel: { baseUrl: "https://env.example.com/v1", apiKey: "sk-env", modelId: "env-model" },
    });
    expect(target).toEqual({ kind: "env", baseUrl: "https://env.example.com/v1", apiKey: "sk-env", modelId: "env-model" });
  });

  it("无连接且环境变量不齐 → 抛错", () => {
    expect(() => resolveModelTarget({ ...base, manifestModel: { connectionId: null, modelId: "mock", mock: false } })).toThrow(/模型尚未配置/);
  });

  it("解密出的密钥可反向验证（与 crypto 联动）", () => {
    expect(decryptApiKey(connection.apiKeyCiphertext, key)).toBe(secret);
  });
});
