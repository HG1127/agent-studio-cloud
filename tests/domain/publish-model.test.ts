// T10 携带裁定（rider B）：发布前模型配置守卫的纯函数单测。
// modelId 为空且未显式 MODEL_MOCK=1 时必须拒绝（中文错误），不得写入永久版本记录。
import { describe, expect, it } from "vitest";
import { resolvePublishModel } from "@/lib/model";

describe("resolvePublishModel", () => {
  it("modelId 为空且未配置 MODEL_MOCK 时拒绝发布", () => {
    const result = resolvePublishModel({ modelId: "", modelMock: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("模型未配置");
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
