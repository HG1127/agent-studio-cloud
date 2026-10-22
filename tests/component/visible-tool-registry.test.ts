import { expect, it, vi } from "vitest";
import { listVisibleToolRegistry } from "@/server/queries/tool-registry";

vi.mock("@/server/tools/tool-registry", () => ({
  listToolRegistryOptions: () => [{
    id: "company-search", name: "业务查询", description: "查询业务记录", risk: "low",
    endpoint: "https://internal.example.test", headers: { Authorization: "secret" },
    action: "search", scope: "private", inputSchema: { type: "object" }, outputSchema: { type: "object" },
  }],
}));

it("只向目录页面投影名称、用途与风险，不传连接或动作配置", () => {
  expect(listVisibleToolRegistry()).toEqual([{ id: "company-search", name: "业务查询", description: "查询业务记录", risk: "low" }]);
});
