// T10 携带裁定（rider B）：发布前模型配置守卫的纯函数单测。
// modelId 为空且未显式 MODEL_MOCK=1 时必须拒绝（中文错误），不得写入永久版本记录。
// T13 携带裁定（rider A）：用户文案不得出现英文环境变量名，变量名只进 console.error 日志。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePublishModel } from "@/lib/model";

describe("resolvePublishModel", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("modelId 为空且未配置 MODEL_MOCK 时拒绝发布，错误为纯中文且变量名只进日志", () => {
    const result = resolvePublishModel({ modelId: "", modelMock: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("模型尚未配置，请先在环境变量中完成模型设置后再发布");
      expect(result.error).not.toMatch(/MODEL_/);
    }
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("MODEL_ID"));
  });
  it("modelId 只有空白字符且未配置 MODEL_MOCK 时同样拒绝", () => {
    const result = resolvePublishModel({ modelId: "   ", modelMock: "0" });
    expect(result.ok).toBe(false);
  });
  it("modelId 为空但显式 MODEL_MOCK=1 时允许，走演示模型", () => {
    const result = resolvePublishModel({ modelId: "", modelMock: "1" });
    expect(result).toEqual({ ok: true, modelId: "mock", mock: true });
  });
  it("配置了 modelId 且未设 MODEL_MOCK 时走真实模型", () => {
    const result = resolvePublishModel({ modelId: "gpt-test", modelMock: undefined });
    expect(result).toEqual({ ok: true, modelId: "gpt-test", mock: false });
  });
  it("配置了 modelId 且 MODEL_MOCK=1 时显式演示模式优先", () => {
    const result = resolvePublishModel({ modelId: "gpt-test", modelMock: "1" });
    expect(result).toEqual({ ok: true, modelId: "gpt-test", mock: true });
  });
});
