import { describe, expect, it } from "vitest";
import { RunStatus } from "@/contracts/run";
import { presentRunTaskResult, presentRunTaskStatus, runTaskLinks } from "./run-task";

const ID = "00000000-0000-4000-8000-000000000151";
const base = { runId: ID, agentId: ID, agentName: "金额助手", versionId: ID, version: 1, startedAt: null, finishedAt: null };

describe("任务状态与交付投影", () => {
  it("生成当前任务的本地入口并拒绝无效标识", () => {
    expect(runTaskLinks(ID)).toEqual({ status: `/api/runs/${ID}`, result: `/api/runs/${ID}/result`, report: `/api/runs/${ID}/export`, events: `/api/runs/${ID}/events`, view: `/runs/${ID}` });
    expect(() => runTaskLinks("../../unsafe")).toThrow();
  });
  it.each(RunStatus.options)("状态 %s 使用统一结束判定并脱敏错误", (status) => {
    const view = presentRunTaskStatus({ ...base, status, error: "token: private-token-123456" });
    expect(view.terminal).toBe(["completed", "failed", "cancelled"].includes(status));
    expect(view.error).toBe(status === "completed" ? null : "[已隐藏敏感信息]");
    expect(view.links).toEqual(runTaskLinks(ID));
  });
  it.each(RunStatus.options)("状态 %s 不把过程中或失败的成果伪装为最终结果", (status) => {
    const view = presentRunTaskResult({ runId: ID, status, result: { amount: 0, approved: false }, error: null, outputContract: { fields: [] } });
    expect(view.ready).toBe(["completed", "failed", "cancelled"].includes(status));
    expect(view.result).toEqual(status === "completed" ? { amount: 0, approved: false } : null);
    expect(view.error).toBe(status === "failed" ? "任务执行失败，请查看运行报告" : status === "cancelled" ? "任务已取消" : null);
  });
  it("保留业务对象、数组、零金额和否定值，只隐藏凭据", () => {
    const value = { amount: 0, approved: false, rows: [null, false, 0, "客户@example.com"], apiKey: "private-key-123456", nested: { text: "Bearer private-token-123456" } };
    const view = presentRunTaskResult({ runId: ID, status: "completed", result: value, error: "旧错误", outputContract: { fields: [{ path: "amount", label: "金额", required: true }] } });
    expect(view.result).toEqual({ ...value, apiKey: "[已隐藏敏感信息]", nested: { text: "[已隐藏敏感信息]" } });
    expect(view.error).toBeNull();
    expect(value.apiKey).toBe("private-key-123456");
    expect(view.outputContract.fields[0]).toMatchObject({ path: "amount", label: "金额" });
  });
  it.each([0, false, "", [], null])("不以真假值判断完成结果 %j", (result) => {
    expect(presentRunTaskResult({ runId: ID, status: "completed", result, error: null, outputContract: { fields: [] } }).result).toEqual(result);
  });
  it("失败错误去除个人信息和凭据，等待中不输出旧错误", () => {
    const task = { runId: ID, result: null, error: "联系 user@example.com token: private-token-123456", outputContract: { fields: [] } };
    const failed = presentRunTaskResult({ ...task, status: "failed" });
    expect(failed.error).not.toMatch(/user@example|private-token/);
    expect(presentRunTaskResult({ ...task, status: "waiting_approval" }).error).toBeNull();
  });
});
