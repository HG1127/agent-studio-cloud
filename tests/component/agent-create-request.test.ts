import { describe, expect, it } from "vitest";
import {
  restoreAgentCreateRequest,
  serializeAgentCreateRequest,
} from "@/features/agents/agent-create-request";

const request = {
  requestId: "00000000-0000-4000-8000-000000000099",
  name: "客服助手",
  intentText: "收到客户咨询后整理资料并生成可审核的回复方案",
};

describe("agent create request recovery", () => {
  it("恢复同一请求标识和提交内容", () => {
    expect(restoreAgentCreateRequest(serializeAgentCreateRequest(request))).toEqual(request);
  });

  it("拒绝损坏、过期或不合法的请求快照", () => {
    expect(restoreAgentCreateRequest(null)).toBeNull();
    expect(restoreAgentCreateRequest("{" )).toBeNull();
    expect(restoreAgentCreateRequest(JSON.stringify({ formatVersion: 2, ...request }))).toBeNull();
    expect(restoreAgentCreateRequest(JSON.stringify({ formatVersion: 1, ...request, requestId: "bad" }))).toBeNull();
    expect(restoreAgentCreateRequest(JSON.stringify({ formatVersion: 1, ...request, intentText: "太短" }))).toBeNull();
  });
});
