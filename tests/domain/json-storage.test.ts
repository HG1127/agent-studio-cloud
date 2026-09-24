import { describe, expect, it } from "vitest";
import {
  jsonStorageIssue,
  MAX_RUN_CONTEXT_BYTES,
  MAX_RUN_RESULT_BYTES,
  MAX_STEP_OUTPUT_BYTES,
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
});
