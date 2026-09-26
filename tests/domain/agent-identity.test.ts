import { describe, expect, it } from "vitest";
import { agentIdentityMatches } from "@/server/domain/agent-identity";

describe("助手请求身份", () => {
  it("只把名称、说明和业务目标完全相同的记录视为同一请求", () => {
    const requested = {
      name: "客户助手",
      description: "处理客户问题",
      intentText: "处理客户问题并生成可核对的答复",
    };
    expect(agentIdentityMatches({ ...requested }, requested)).toBe(true);
    expect(agentIdentityMatches({ ...requested, description: "另一份说明" }, requested)).toBe(false);
    expect(agentIdentityMatches({ ...requested, intentText: "另一项业务目标" }, requested)).toBe(false);
  });
});
