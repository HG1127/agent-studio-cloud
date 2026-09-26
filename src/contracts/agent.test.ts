import { describe, expect, it } from "vitest";
import { AgentTargetOption } from "./agent";

const baseOption = {
  agentId: "00000000-0000-4000-8000-000000000001",
  agentName: "目标助手",
  versionId: "00000000-0000-4000-8000-000000000002",
  version: 1,
  inputContract: { fields: [{ name: "request", type: "string", required: true }] },
  outputContract: { fields: [{ path: "result", required: true }] },
};

describe("AgentTargetOption", () => {
  it("保留前端需要的输入输出字段", () => {
    expect(AgentTargetOption.parse(baseOption)).toMatchObject(baseOption);
  });

  it("拒绝不符合已发布清单结构的目标契约", () => {
    expect(AgentTargetOption.safeParse({ ...baseOption, inputContract: { fields: [{ name: "__proto__" }] } }).success).toBe(false);
    expect(AgentTargetOption.safeParse({ ...baseOption, outputContract: { fields: "result" } }).success).toBe(false);
  });
});
