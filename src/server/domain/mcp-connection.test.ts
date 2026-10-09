import { describe, expect, it } from "vitest";
import { McpConnectionCheckInput, McpConnectionRegistration } from "@/contracts/mcp-connection";
import { compareMcpDirectory, parseMcpConnections } from "./mcp-connection";
const registration = McpConnectionRegistration.parse({
  id: "service", name: "查询服务", workspaceId: "00000000-0000-4000-8000-000000000001", endpoint: "https://service.example/mcp",
  headers: { Authorization: "Bearer secret" }, tools: [{ registryToolId: "lookup", name: "查询记录", action: "lookup", inputSchema: { type: "object", properties: { term: { type: "string" } } } }],
});
const definition = { name: "lookup", inputSchema: { properties: { term: { type: "string" } }, type: "object" } };
describe("MCP 安全连接契约", () => {
  it("拒绝客户端地址、凭据与工作区覆盖", () => {
    expect(McpConnectionCheckInput.safeParse({ connectionId: "service" }).success).toBe(true);
    for (const key of ["endpoint", "headers", "workspaceId", "apiKey"]) expect(McpConnectionCheckInput.safeParse({ connectionId: "service", [key]: "secret" }).success).toBe(false);
  });
  it("区分未配置与错误配置，拒绝重复登记", () => {
    expect(parseMcpConnections(undefined)).toEqual([]);
    expect(parseMcpConnections("invalid")).toBeNull();
    expect(parseMcpConnections(JSON.stringify([registration, registration]))).toBeNull();
    expect(parseMcpConnections(JSON.stringify([registration]))).toEqual([registration]);
  });
  it("拒绝不安全地址、头、参数定义与超大配置", () => {
    for (const endpoint of ["ftp://service.example/mcp", "https://user:secret@service.example/mcp"]) expect(parseMcpConnections(JSON.stringify([{ ...registration, endpoint }]))).toBeNull();
    for (const headers of [{ Cookie: "secret" }, { host: "other" }, { Authorization: "secret\r\ninjection" }, { Authorization: "a", authorization: "b" }]) expect(parseMcpConnections(JSON.stringify([{ ...registration, headers }]))).toBeNull();
    expect(parseMcpConnections(" ".repeat(1024 * 1024) + "[]")).toBeNull();
    expect(parseMcpConnections(JSON.stringify([{ ...registration, tools: [{ ...registration.tools[0], inputSchema: { type: "string" } }] }]))).toBeNull();
  });
});
describe("目录核对", () => {
  it("允许字段顺序差异，仅返回管理员登记元数据", () => {
    const result = compareMcpDirectory(registration, [{ ...definition, description: "secret", title: "secret" }, { name: "unregistered", inputSchema: { type: "object" } }]);
    expect(result.status).toBe("available");
    expect(result.tools).toEqual([{ registryToolId: "lookup", name: "查询记录", status: "available" }]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("unregistered");
  });
  it("参数变化或工具消失禁止绑定", () => {
    expect(compareMcpDirectory(registration, [{ ...definition, inputSchema: { type: "object" } }]).tools[0].status).toBe("definition-changed");
    expect(compareMcpDirectory(registration, []).tools[0].status).toBe("missing");
  });
  it("已登记输出定义变化也失败", () => {
    expect(compareMcpDirectory({ ...registration, tools: [{ ...registration.tools[0], outputSchema: { type: "object" } }] }, [definition]).status).toBe("definition-changed");
  });
  it("拒绝跨页重复工具与非法定义", () => {
    expect(compareMcpDirectory(registration, [definition, definition]).status).toBe("protocol-error");
    expect(compareMcpDirectory(registration, [{ ...definition, inputSchema: null }]).status).toBe("protocol-error");
  });
});

it("兼容管理员已登记的本机 HTTP 和 HTTPS 查询参数地址", () => {
  for (const endpoint of ["http://127.0.0.1:3001/mcp", "https://service.example/mcp?version=1", "https://service.example"]) expect(parseMcpConnections(JSON.stringify([{ ...registration, endpoint }]))?.[0].endpoint).toBe(endpoint);
});
