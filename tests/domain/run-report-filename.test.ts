import { describe, expect, it } from "vitest";
import { AgentCreateInput } from "@/contracts/agent";
import { runReportFilename } from "@/server/domain/runtime/run-report-filename";

const EXPORTED = "2026-10-16T01:00:00.000Z";
const base = { agentName: "成果助手", finishedAt: null, startedAt: null };

describe("报告下载文件名", () => {
  it.each([
    { name: "普通助手", expected: "普通助手" },
    { name: "", expected: "run" },
    { name: "  ", expected: "-" },
    { name: "甲/乙\\丙\r\n丁\";", expected: "甲-乙-丙-丁-" },
    { name: "\uD800中\uDC00", expected: "-中-" },
  ])("过滤文件名分隔符及无效字符：$expected", ({ name, expected }) => {
    const filename = runReportFilename({ ...base, agentName: name }, EXPORTED);
    expect(filename).toBe(`${expected}-2026-10-16-运行报告.json`);
    expect(() => encodeURIComponent(filename)).not.toThrow();
    expect(filename).not.toMatch(/[\\/\r\n";]/);
  });

  it("合法助手名的第50个码点是扩展汉字时，不保留孤立代理项导致下载编码失败", () => {
    const name = "a".repeat(49) + "𠮷";
    expect(AgentCreateInput.shape.name.safeParse(name).success).toBe(true);
    const oldPrefix = name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 50);
    expect(() => encodeURIComponent(oldPrefix)).toThrow(URIError);
    const filename = runReportFilename({ ...base, agentName: name }, EXPORTED);
    expect(filename).toBe(`${name}-2026-10-16-运行报告.json`);
    expect(decodeURIComponent(encodeURIComponent(filename))).toBe(filename);
  });

  it.each(["a".repeat(70), "𠮷".repeat(70)])("历史长名称仍限制50个完整码点并保持文件名字节有界", (name) => {
    const filename = runReportFilename({ ...base, agentName: name }, EXPORTED);
    const prefix = filename.slice(0, -"-2026-10-16-运行报告.json".length);
    expect(Array.from(prefix)).toHaveLength(50);
    expect(new TextEncoder().encode(filename).byteLength).toBeLessThanOrEqual(255);
    expect(decodeURIComponent(encodeURIComponent(filename))).toBe(filename);
  });

  it.each([
    { name: "sk-" + "a".repeat(20), privatePart: "sk-" + "a".repeat(20) },
    { name: "pat_" + "b".repeat(64), privatePart: "pat_" + "b".repeat(64) },
    { name: "Bearer fixture-private-123456789", privatePart: "fixture-private-123456789" },
    { name: "finance@example.com", privatePart: "finance@example.com" },
    { name: "13800000000", privatePart: "13800000000" },
    { name: "postgres://reader:fixture-pass@db.example", privatePart: "reader:fixture-pass" },
    { name: "token: fixture-private-123456789", privatePart: "fixture-private-123456789" },
  ])("下载响应头的名称不携带敏感文字：$name", ({ name, privatePart }) => {
    const filename = runReportFilename({ ...base, agentName: name }, EXPORTED);
    expect(filename).toContain("已隐藏敏感信息");
    expect(filename).not.toContain(privatePart);
    expect(decodeURIComponent(encodeURIComponent(filename))).toBe(filename);
  });

  it.each([
    { finishedAt: "2026-09-30T01:00:00.000Z", startedAt: "2026-09-29T01:00:00.000Z", date: "2026-09-30" },
    { finishedAt: null, startedAt: "2026-09-29T01:00:00.000Z", date: "2026-09-29" },
    { finishedAt: "2026-13-99T01:00:00.000Z", startedAt: "2026-09-29T01:00:00.000Z", date: "2026-09-29" },
    { finishedAt: "\uD800历史错误时间", startedAt: null, date: "2026-10-16" },
    { finishedAt: "", startedAt: "Bearer fixture-private-time", date: "2026-10-16" },
  ])("只用合法时间生成日期：$date", ({ finishedAt, startedAt, date }) => {
    expect(runReportFilename({ ...base, finishedAt, startedAt }, EXPORTED)).toBe(`成果助手-${date}-运行报告.json`);
  });

  it("先脱敏再截断，且不改写助手名称或原运行时间", () => {
    const run = { agentName: "x".repeat(35) + " pat_" + "b".repeat(64), finishedAt: "历史错误时间", startedAt: null };
    const original = JSON.stringify(run), filename = runReportFilename(run, EXPORTED);
    expect(filename).not.toMatch(/pat_|b{8}/);
    expect(JSON.stringify(run)).toBe(original);
  });

  it("无效导出时间明确拒绝，不通过当前时钟虚构日期", () => {
    expect(() => runReportFilename({ ...base, finishedAt: "2026-09-30T01:00:00.000Z" }, "not-a-time")).toThrow();
  });
});
