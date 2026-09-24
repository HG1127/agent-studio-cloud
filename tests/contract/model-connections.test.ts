import { describe, expect, it } from "vitest";
import { ModelConnectionCreateInput, ModelConnectionSaveInput } from "@/contracts/connections";

const input = {
  name: "测试连接",
  baseUrl: "https://api.example.com/v1",
  apiKey: "sk-test-000000",
  modelIds: ["test-model"],
};

describe("模型连接输入", () => {
  it.each(["file:///tmp/key", "ftp://example.com", "https://user:secret@example.com/v1"])("拒绝不安全的服务地址 %s", (baseUrl) => {
    expect(ModelConnectionCreateInput.safeParse({ ...input, baseUrl }).success).toBe(false);
  });

  it("创建连接必须填写密钥", () => {
    expect(ModelConnectionSaveInput.safeParse({ ...input, apiKey: "" }).success).toBe(false);
  });

  it("编辑连接允许省略密钥，保留原有密钥", () => {
    const parsed = ModelConnectionSaveInput.parse({ ...input, id: "00000000-0000-4000-8000-0000000000c1", apiKey: "" });
    expect(parsed).toMatchObject({ id: "00000000-0000-4000-8000-0000000000c1" });
    expect(parsed.apiKey).toBeUndefined();
  });

  it("错误的编辑标识不能被当成新增连接", () => {
    expect(ModelConnectionSaveInput.safeParse({ ...input, id: "bad-id" }).success).toBe(false);
  });
});
