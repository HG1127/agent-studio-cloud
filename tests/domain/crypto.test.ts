import { describe, expect, it } from "vitest";
import { apiKeyHint, decryptApiKey, encryptApiKey, generateModelEncryptionKey, resolveEncryptionKey } from "@/server/domain/crypto";

const key = resolveEncryptionKey(generateModelEncryptionKey()) as Buffer;

describe("模型密钥加解密", () => {
  it("主钥只接受 64 位十六进制", () => {
    expect(resolveEncryptionKey(generateModelEncryptionKey())).not.toBeNull();
    expect(resolveEncryptionKey("abc")).toBeNull();
    expect(resolveEncryptionKey(undefined)).toBeNull();
    expect(resolveEncryptionKey("z".repeat(64))).toBeNull();
  });

  it("加密后可解密还原，密文不含明文片段", () => {
    const secret = "sk-test-1234567890";
    const payload = encryptApiKey(secret, key);
    expect(payload).not.toContain(secret);
    expect(payload.split(":")).toHaveLength(3);
    expect(decryptApiKey(payload, key)).toBe(secret);
  });

  it("同一明文两次加密产出不同密文（随机 iv）", () => {
    expect(encryptApiKey("sk-a", key)).not.toBe(encryptApiKey("sk-a", key));
  });

  it("篡改密文或用错密钥解密必须抛错", () => {
    const payload = encryptApiKey("sk-a", key);
    const [iv, tag, data] = payload.split(":");
    const tampered = `${iv}:${tag}:${data!.slice(0, -2)}ff`;
    expect(() => decryptApiKey(tampered, key)).toThrow();
    expect(() => decryptApiKey(payload, resolveEncryptionKey(generateModelEncryptionKey()) as Buffer)).toThrow();
  });

  it("密文格式不完整直接抛错", () => {
    expect(() => decryptApiKey("not-a-payload", key)).toThrow();
  });

  it("掩码只留末 4 位", () => {
    expect(apiKeyHint("sk-abcdef12")).toBe("****ef12");
    expect(apiKeyHint("abc")).toBe("****");
  });
});
