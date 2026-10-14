import { describe, expect, it } from "vitest";
import { MAX_RUN_INPUT_BYTES, MAX_RUN_RESULT_BYTES, RunStatus } from "./run";
import { RunTaskReference, RunTaskResult, RunTaskResultView, RunTaskStartInput, RunTaskStartResult, RunTaskStatusView } from "./run-task";

const ID = "00000000-0000-4000-8000-000000000141";
const OTHER = "00000000-0000-4000-8000-000000000142";
const links = { status: `/api/runs/${ID}`, result: `/api/runs/${ID}/result`, report: `/api/runs/${ID}/export`, events: `/api/runs/${ID}/events`, view: `/runs/${ID}` };
const result = { runId: ID, status: "completed", ready: true, result: { amount: 0, approved: false }, error: null, links };

describe("程序化任务契约", () => {
  it("请求标识必填并保留原有输入默认值", () => {
    expect(RunTaskStartInput.parse({ agentId: ID, requestId: OTHER })).toEqual({ agentId: ID, requestId: OTHER, input: {} });
    expect(RunTaskStartInput.safeParse({ agentId: ID, input: {} }).success).toBe(false);
  });
  it("支持指定冻结版本与结构化业务输入", () => {
    const input = { agentId: ID, requestId: OTHER, versionId: OTHER, input: { amount: 0, approved: false, rows: [1, 2] } };
    expect(RunTaskStartInput.parse(input)).toEqual(input);
  });
  it("相同 UUID 的大小写表示归一化，不能形成第二个防重键", () => {
    const lower = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const upper = lower.toUpperCase();
    expect(RunTaskStartInput.parse({ agentId: upper, requestId: upper, versionId: upper })).toEqual({ agentId: lower, requestId: lower, versionId: lower, input: {} });
    expect(RunTaskReference.parse({ runId: upper })).toEqual({ runId: lower });
  });
  it.each(["agentId", "requestId", "versionId"])("拒绝非法 %s", (field) => {
    expect(RunTaskStartInput.safeParse({ agentId: ID, requestId: OTHER, [field]: "bad" }).success).toBe(false);
  });
  it.each(["workspaceId", "sourceType", "sourceKey", "callbackUrl", "manifest"])("不能通过 %s 改写服务端边界", (field) => {
    expect(RunTaskStartInput.safeParse({ agentId: ID, requestId: OTHER, [field]: "unsafe" }).success).toBe(false);
  });
  it("继承输入大小、保留字段与 JSON 数据限制", () => {
    for (const input of [{ brief: "中".repeat(MAX_RUN_INPUT_BYTES) }, { amount: Infinity }, JSON.parse('{"constructor":{}}'), []]) {
      expect(RunTaskStartInput.safeParse({ agentId: ID, requestId: OTHER, input }).success).toBe(false);
    }
  });
  it("成功提交只链接到同一次运行", () => {
    expect(RunTaskStartResult.parse({ ok: true, runId: ID, links })).toEqual({ ok: true, runId: ID, links });
    for (const field of Object.keys(links)) {
      expect(RunTaskStartResult.safeParse({ ok: true, runId: ID, links: { ...links, [field]: links.view.replace(ID, OTHER) } }).success).toBe(false);
    }
    expect(RunTaskStartResult.safeParse({ ok: true, runId: ID, links: { ...links, view: "https://other.example" } }).success).toBe(false);
  });
  it.each(RunStatus.options)("状态 %s 的结束标记必须一致", (status) => {
    const terminal = ["completed", "failed", "cancelled"].includes(status);
    const task = { runId: ID, agentId: OTHER, agentName: "业务助手", versionId: OTHER, version: 1, status, terminal, error: null, startedAt: null, finishedAt: null, links };
    expect(RunTaskStatusView.safeParse(task).success).toBe(true);
    expect(RunTaskStatusView.safeParse({ ...task, terminal: !terminal }).success).toBe(false);
  });
  it.each(RunStatus.options)("结果 %s 的就绪标记与最终结果边界一致", (status) => {
    const ready = ["completed", "failed", "cancelled"].includes(status);
    const task = { ...result, status, ready, result: status === "completed" ? result.result : null };
    expect(RunTaskResultView.safeParse(task).success).toBe(true);
    expect(RunTaskResultView.safeParse({ ...task, ready: !ready }).success).toBe(false);
    if (status !== "completed") expect(RunTaskResultView.safeParse({ ...task, result: { partial: true } }).success).toBe(false);
  });
  it("成功结果不能携带旧失败错误并默认空交付契约", () => {
    expect(RunTaskResultView.parse(result).outputContract).toEqual({ fields: [] });
    expect(RunTaskResultView.safeParse({ ...result, error: "旧错误" }).success).toBe(false);
  });
  it("结果验证有界，非法、超限和循环值不会进入响应", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const value of [circular, { data: "中".repeat(MAX_RUN_RESULT_BYTES) }, { value: Infinity }, { value: undefined }, JSON.parse('{"__proto__":{}}')]) {
      expect(RunTaskResultView.safeParse({ ...result, result: value }).success).toBe(false);
    }
  });
  it("读取成功与任务业务成功是不同状态", () => {
    expect(RunTaskResult.parse({ ok: true, task: { ...result, status: "failed", result: null, error: "任务失败" } })).toMatchObject({ ok: true, task: { status: "failed", ready: true, result: null } });
    expect(RunTaskStartResult.parse({ ok: false, error: "稍后重试", retryable: true })).toEqual({ ok: false, error: "稍后重试", retryable: true });
  });
});
