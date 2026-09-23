// 连接密钥加解密：AES-256-GCM，密文格式 iv:tag:ciphertext（均 hex）。
// 纯 domain 函数：主钥由调用方解析后以参数传入，本文件不读环境变量。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function resolveEncryptionKey(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;
  return Buffer.from(value, "hex");
}

export function generateModelEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

export function encryptApiKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptApiKey(payload: string, key: Buffer): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("密文格式不完整");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

export function apiKeyHint(plaintext: string): string {
  const tail = plaintext.length >= 4 ? plaintext.slice(-4) : "";
  return `****${tail}`;
}
