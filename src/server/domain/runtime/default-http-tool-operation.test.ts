import { describe, expect, it } from "vitest";
import { defaultHttpStepOperationKey, defaultHttpStepRequestJson, defaultHttpStepRetryDeadline } from "./default-http-tool-operation";
import { toolStepIdempotencyKey } from "./tool-step-idempotency-key";

const identity = { workspaceId: "work-1", toolId: "orders", action: "create", runId: "run-1", nodeId: "write", stepId: "step-1" };

describe("默认 HTTP 写步骤的稳定防重定位", () => {
  it("沿用原 HTTP 独立命名空间和可传输的旧外部键", () => {
    expect(defaultHttpStepOperationKey(identity)).toEqual({
      ok: true, material: JSON.stringify(["http-default-step:v1", "work-1", "orders", "create", "run-1", "write", "step-1"]),
      idempotencyKey: "run-1:write:step-1",
    });
  });

  it("中文内联步骤只编码外部头，不改持久定位，也不截断名称", () => {
    const input = { ...identity, nodeId: "group.登记订单" };
    const result = defaultHttpStepOperationKey(input);
    expect(result).toEqual({
      ok: true, material: JSON.stringify(["http-default-step:v1", "work-1", "orders", "create", "run-1", input.nodeId, "step-1"]),
      idempotencyKey: toolStepIdempotencyKey(input),
    });
    expect(result.ok && new Headers({ "idempotency-key": result.idempotencyKey }).get("idempotency-key"))
      .toMatch(/^studio-step-header:v1:[0-9a-f]{64}$/);
    expect(defaultHttpStepOperationKey({ ...identity, nodeId: "n".repeat(1000) }).ok).toBe(true);
  });

  it.each(["workspaceId", "toolId", "action", "runId", "nodeId", "stepId"] as const)("定位包含实际%s，不把其他业务或循环调用混用", (field) => {
    expect(defaultHttpStepOperationKey({ ...identity, [field]: "other" })).not.toEqual(defaultHttpStepOperationKey(identity));
  });

  it.each(["", "\u0000", "write\nnext", "\u007f", "x".repeat(1001)])("拒绝无效步骤定位，不发送正文 %j", (value) => {
    expect(defaultHttpStepOperationKey({ ...identity, stepId: value })).toEqual({
      ok: false, error: "工具步骤执行标识无法确认，不能发起业务操作",
    });
  });
});

describe("默认 HTTP 写步骤的不可延长期限", () => {
  it("首次时间锚定有效期，晚到的重试和当前时间不延长截止", () => {
    expect(defaultHttpStepRetryDeadline(new Date(1000), 600_000, new Date(2000)))
      .toEqual({ ok: true, deadline: new Date(481_000) });
    expect(defaultHttpStepRetryDeadline(new Date(1000), 600_000, new Date(900_000)))
      .toEqual({ ok: true, deadline: new Date(481_000) });
  });

  it.each([299_999, 31_536_000_001, Infinity, NaN, 300_000.5])("拒绝未实际保证的有效期 %s", (retention) => {
    expect(defaultHttpStepRetryDeadline(new Date(1000), retention, new Date(2000))).toMatchObject({ ok: false });
  });

  it("未来、无效、溢出或伪造的日期失败关闭，不调用自定义日期函数", () => {
    const getter = () => { throw new Error("must not run"); };
    const fake = { getTime: getter } as unknown as Date;
    expect(defaultHttpStepRetryDeadline(new Date(3000), 600_000, new Date(2000))).toMatchObject({ ok: false });
    expect(defaultHttpStepRetryDeadline(new Date(NaN), 600_000, new Date(2000))).toMatchObject({ ok: false });
    expect(defaultHttpStepRetryDeadline(fake, 600_000, new Date(2000))).toMatchObject({ ok: false });
    expect(defaultHttpStepRetryDeadline(new Date(1000), 600_000, fake)).toMatchObject({ ok: false });
    expect(defaultHttpStepRetryDeadline(new Date(8_640_000_000_000_000), 600_000, new Date(8_640_000_000_000_000))).toMatchObject({ ok: false });
  });
});

describe("仅 HTTP 默认分支的固定请求摘要", () => {
  it("递归忽略同字段重排，但保留完整 action/input/outputs、零值和否值", () => {
    const left = ["http-json", "action", { action: "create", input: { amount: 0, approved: false, customer: { b: 2, a: 1 } }, outputs: { plan: { id: "p1" } } }];
    const right = ["http-json", "action", { outputs: { plan: { id: "p1" } }, input: { customer: { a: 1, b: 2 }, approved: false, amount: 0 }, action: "create" }];
    expect(defaultHttpStepRequestJson(left)).toBe(defaultHttpStepRequestJson(right));
    expect(JSON.parse(defaultHttpStepRequestJson(left))).toEqual(left);
    expect(defaultHttpStepRequestJson(left)).not.toBe(defaultHttpStepRequestJson(["http-json", "action", { ...left[2] as object, outputs: {} }]));
  });

  it("Unicode 字段不按本机语言合并，数组顺序与字段值变化仍形成不同请求", () => {
    const left = { "\u00e9": 1, "e\u0301": 2, rows: [0, false] };
    const right = { rows: [0, false], "e\u0301": 2, "\u00e9": 1 };
    expect(defaultHttpStepRequestJson(left)).toBe(defaultHttpStepRequestJson(right));
    expect(defaultHttpStepRequestJson(left)).not.toBe(defaultHttpStepRequestJson({ ...left, rows: [false, 0] }));
    expect(defaultHttpStepRequestJson(left)).not.toBe(defaultHttpStepRequestJson({ ...left, "\u00e9": 2 }));
  });
});
