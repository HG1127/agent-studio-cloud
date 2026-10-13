import { createHash } from "node:crypto";
import { mkdtemp, writeFile, link, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readOwnedWorkflowJson, readOwnedWorkflowJsonWithHash } from "../helpers/read-owned-workflow-json";

let fixture: string;
beforeEach(async () => { fixture = await mkdtemp(path.join(os.tmpdir(), "owned-json-reader-")); });
afterEach(async () => {
  const absolute = path.resolve(fixture), parent = path.resolve(os.tmpdir());
  if (!path.isAbsolute(fixture) || path.dirname(absolute) !== parent
    || !path.basename(absolute).startsWith("owned-json-reader-")) throw new Error("拒绝清理非自建样本目录");
  await rm(absolute, { recursive: true, force: false });
});

describe("自有验收文件有界读取", () => {
  it("相同语义不同成员顺序和空白保留不同原字节哈希", async () => {
    const texts = ['{"version":1,"name":"中文"}', '{ "name": "中文", "version": 1 }'];
    const results = [];
    for (let index = 0; index < texts.length; index++) {
      const file = path.join(fixture, index + ".json");
      await writeFile(file, texts[index], "utf8");
      const result = await readOwnedWorkflowJsonWithHash(file, 256);
      expect(result.sha256).toBe(createHash("sha256").update(Buffer.from(texts[index], "utf8")).digest("hex"));
      results.push(result);
    }
    expect(results[0].value).toEqual(results[1].value);
    expect(results[0].sha256).not.toBe(results[1].sha256);
  });
  it("旧读取接口只返回同一个解析值", async () => {
    const file = path.join(fixture, "compat.json");
    await writeFile(file, '{"ok":true,"amount":0}', "utf8");
    expect(await readOwnedWorkflowJson(file, 128)).toEqual((await readOwnedWorkflowJsonWithHash(file, 128)).value);
  });
  it("拒绝非法UTF8，不替换为合法字符", async () => {
    const file = path.join(fixture, "invalid.json");
    await writeFile(file, Buffer.from([0x22, 0xc3, 0x28, 0x22]));
    await expect(readOwnedWorkflowJson(file, 128)).rejects.toThrow();
  });
  it("恰好字节上限允许，少一字节拒绝", async () => {
    const file = path.join(fixture, "limit.json"), bytes = Buffer.from('"中文"', "utf8");
    await writeFile(file, bytes);
    expect(await readOwnedWorkflowJson(file, bytes.length)).toBe("中文");
    await expect(readOwnedWorkflowJson(file, bytes.length - 1)).rejects.toThrow();
  });
  it("原生硬链接导致单一归属不成立", async () => {
    const file = path.join(fixture, "original.json"), alias = path.join(fixture, "hard.json");
    await writeFile(file, "{}");
    await link(file, alias);
    await expect(readOwnedWorkflowJson(file, 128)).rejects.toThrow();
    await expect(readOwnedWorkflowJson(alias, 128)).rejects.toThrow();
  });
  it("拒绝原生符号链接，不跳过平台创建失败", async () => {
    const file = path.join(fixture, "original.json"), alias = path.join(fixture, "symbolic.json");
    await writeFile(file, "{}");
    await symlink(file, alias, "file");
    await expect(readOwnedWorkflowJson(alias, 128)).rejects.toThrow();
  });
  it("拒绝带访问器的非字符串路径且不调用访问器", async () => {
    let reads = 0;
    const hostile = Object.defineProperty({}, "toString", { get: () => { reads++; throw new Error("不应调用"); } });
    await expect(readOwnedWorkflowJson(hostile as unknown as string, 128)).rejects.toThrow();
    expect(reads).toBe(0);
  });
  it.each([0, -1, 1.5, Number.NaN, 4 * 1024 * 1024 + 1])("拒绝非法上限 %s", async (limit) => {
    const file = path.join(fixture, "bound.json");
    await writeFile(file, "{}");
    await expect(readOwnedWorkflowJson(file, limit)).rejects.toThrow();
  });
});
