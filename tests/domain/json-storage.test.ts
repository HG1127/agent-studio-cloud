import { describe, expect, it } from "vitest";
import { isPassiveJsonData } from "@/contracts/json";
import {
  jsonStorageIssue,
  MAX_RUN_CONTEXT_BYTES,
  MAX_RUN_RESULT_BYTES,
  MAX_STEP_OUTPUT_BYTES,
  stepOutputStorageIssue,
} from "@/server/domain/runtime/json-storage";

describe("运行 JSON 存储边界", () => {
  it("允许各层级上限内的普通 JSON", () => {
    expect(jsonStorageIssue({ output: "完成" }, MAX_STEP_OUTPUT_BYTES, "步骤输出")).toBeNull();
    expect(jsonStorageIssue({ result: [1, 2, 3] }, MAX_RUN_RESULT_BYTES, "运行结果")).toBeNull();
    expect(jsonStorageIssue({ outputs: { a: true } }, MAX_RUN_CONTEXT_BYTES, "运行上下文")).toBeNull();
  });

  it("拒绝超限内容并返回明确的中文上限", () => {
    expect(jsonStorageIssue({ output: "x".repeat(MAX_STEP_OUTPUT_BYTES) }, MAX_STEP_OUTPUT_BYTES, "步骤输出"))
      .toBe("步骤输出不能超过 1MB");
    expect(jsonStorageIssue({ output: "x".repeat(MAX_RUN_RESULT_BYTES) }, MAX_RUN_RESULT_BYTES, "运行结果"))
      .toBe("运行结果不能超过 2MB");
  });

  it("拒绝循环引用和无法序列化的根值", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(jsonStorageIssue(circular, MAX_STEP_OUTPUT_BYTES, "步骤输出")).toBe("步骤输出必须是可保存的 JSON 数据");
    expect(jsonStorageIssue(undefined, MAX_STEP_OUTPUT_BYTES, "步骤输出")).toBe("步骤输出必须是可保存的 JSON 数据");
  });

  it("拒绝序列化时会丢失或改写的嵌套值", () => {
    for (const value of [undefined, () => "ignored", new Date("2026-09-27"), Number.NaN]) {
      expect(jsonStorageIssue({ value }, MAX_STEP_OUTPUT_BYTES, "步骤输出"))
        .toBe("步骤输出必须是可保存的 JSON 数据");
    }
  });

  it.each([0, 9, 10])("工具成功标记不挤占合法业务体容量（余量 %i 字节）", (margin) => {
    const raw = { receiptId: "r1", text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - margin - new TextEncoder().encode(JSON.stringify(raw)).byteLength);
    const output = { ok: true, ...raw };
    const before = JSON.stringify(output);
    expect(new TextEncoder().encode(before).byteLength).toBe(MAX_STEP_OUTPUT_BYTES - margin + 10);
    expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBeNull();
    expect(JSON.stringify(output)).toBe(before);
    expect(output.ok).toBe(true);
  });

  it("仍拒绝超过1MB的工具业务体，不把标记预留变成业务扩容", () => {
    const output = { ok: true, text: "" };
    output.text = "x".repeat(MAX_STEP_OUTPUT_BYTES + 11 - JSON.stringify(output).length);
    expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBe("步骤输出不能超过 1MB");
  });

  it.each(["ai", "knowledge", "system", "subflow", "parallel", "unknown"])("%s 节点不借用工具标记容量", (nodeType) => {
    const output = { ok: true, text: "" };
    output.text = "x".repeat(MAX_STEP_OUTPUT_BYTES + 1 - JSON.stringify(output).length);
    expect(stepOutputStorageIssue(output, nodeType, "步骤输出")).toBe("步骤输出不能超过 1MB");
  });

  it.each([false, "true", 1, null])("非成功标记不获得额外容量 %#", (ok) => {
    const output = { ok, text: "" };
    output.text = "x".repeat(MAX_STEP_OUTPUT_BYTES + 1 - JSON.stringify(output).length);
    expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBe("步骤输出不能超过 1MB");
  });

  it("继承、隐藏和访问器标记不能冒充内部成功字段", () => {
    const body = { text: "x".repeat(MAX_STEP_OUTPUT_BYTES - JSON.stringify({ text: "" }).length + 1) };
    const inherited = Object.assign(Object.create({ ok: true }), body);
    const hidden = Object.defineProperty({ ...body }, "ok", { value: true });
    const accessor = Object.defineProperty({ text: body.text.slice(0, -10) }, "ok", { enumerable: true, get: () => true });
    for (const output of [inherited, hidden, accessor]) {
      expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBe(MAX_STEP_OUTPUT_BYTES + 1);
      expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBe("步骤输出不能超过 1MB");
    }
  });

  it("工具回执仍按实际UTF-8与转义后的字节计算", () => {
    const raw = { message: "退款成功", quoted: '"\\\n', text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - new TextEncoder().encode(JSON.stringify(raw)).byteLength);
    const output = { ok: true, ...raw };
    expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBeNull();
    expect(stepOutputStorageIssue({ ...output, text: output.text + "x" }, "tool", "步骤输出"))
      .toBe("步骤输出不能超过 1MB");
  });

  it("成功标记不会让无效JSON或自定义序列化进入存储", () => {
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;
    for (const output of [circular, { ok: true, value: undefined }, { ok: true, value: new Date() },
      { ok: true, toJSON: () => ({ ok: true }) }]) {
      expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBe("步骤输出必须是可保存的 JSON 数据");
    }
  });

  it("无法识别原型的代理保留容量错误而不抛出异常", () => {
    const raw = { ok: true, text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES + 1 - JSON.stringify(raw).length);
    const value = new Proxy(raw, { getPrototypeOf: () => { throw new Error("不能读取原型"); } });
    expect(stepOutputStorageIssue(value, "tool", "步骤输出")).toBe("步骤输出不能超过 1MB");
  });

  it("隐藏的自定义序列化不能把标记预留挪给业务数据", () => {
    const body = { text: "" };
    body.text = "x".repeat(MAX_STEP_OUTPUT_BYTES + 1 - JSON.stringify(body).length);
    let calls = 0;
    const value = Object.defineProperty({ ok: true, text: "" }, "toJSON", { value: () => { calls += 1; return body; } });
    expect(stepOutputStorageIssue(value, "tool", "步骤输出")).toBe("步骤输出不能超过 1MB");
    expect(calls).toBe(1);
  });

  it("可变业务访问器不能借助第二次序列化获得标记预留", () => {
    const template = { ok: true, text: "" };
    const length = MAX_STEP_OUTPUT_BYTES + 1 - JSON.stringify(template).length;
    let calls = 0;
    const value = Object.defineProperty({ ok: true }, "text", { enumerable: true, get: () => {
      calls += 1;
      return "x".repeat(calls === 1 ? length : 0);
    } });
    expect(stepOutputStorageIssue(value, "tool", "步骤输出")).toBe("步骤输出不能超过 1MB");
    expect(calls).toBe(1);
  });

  it("普通toJSON业务字符串仍是合法数据而非序列化钩子", () => {
    const raw = { toJSON: "业务字段", text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - new TextEncoder().encode(JSON.stringify(raw)).byteLength);
    const output = { ok: true, ...raw };
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBe(MAX_STEP_OUTPUT_BYTES + 10);
    expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBeNull();
  });

  it.each(["deep", "many"])("合法HTTP %s JSON不借用字段定义专用的层数和项目限制", (layout) => {
    let nested: unknown = 0;
    for (let depth = 0; depth < 40; depth += 1) nested = { value: nested };
    const raw = { value: layout === "deep" ? nested : Array.from({ length: 50_000 }, () => 0), text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - new TextEncoder().encode(JSON.stringify(raw)).byteLength);
    const output = { ok: true, ...raw };
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBe(MAX_STEP_OUTPUT_BYTES + 10);
    expect(isPassiveJsonData(output, MAX_STEP_OUTPUT_BYTES + 10)).toBe(false);
    expect(stepOutputStorageIssue(output, "tool", "步骤输出")).toBeNull();
  });
});
