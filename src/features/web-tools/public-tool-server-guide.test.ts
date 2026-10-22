import { describe, expect, it } from "vitest";
import { PublicToolCallInput } from "@/contracts/public-agent-tool";
import { buildPublicToolServerGuide, SERVER_GUIDE_REQUEST_ID } from "./public-tool-server-guide";

const toolId = "11111111-1111-4111-8111-11111111111a";

describe("网页工具现有服务端协议的接入说明", () => {
  it("规范站点与工具标识，使用当前真实调用路由，不补造公开页面", () => {
    const guide = buildPublicToolServerGuide(" https://EXAMPLE.com:443/ ", toolId.toUpperCase());
    expect(guide.ok).toBe(true);
    if (!guide.ok) throw new Error(guide.error);
    expect(guide.origin).toBe("https://example.com");
    expect(guide.local).toBe(false);
    expect(guide.endpoint).toBe("https://example.com/api/public-tools/" + toolId + "/calls");
  });

  it.each(["http://localhost:3231", "http://127.0.0.1:3231/", "http://[::1]:3231/"])("本机调试地址单独标识：%s", (address) => {
    const guide = buildPublicToolServerGuide(address, toolId);
    expect(guide.ok && guide.local).toBe(true);
  });

  it.each([
    "", "不是地址", "//example.com", "http://example.com", "ftp://example.com/", "javascript:alert(1)",
    "https://user:secret@example.com", "https://user@example.com", "https://example.com/path",
    "https://example.com/?token=private", "https://example.com/#private", "https://exa\nmple.com",
    "https://ex'ample.com", "https://example.com/" + "a".repeat(2048),
  ])("不将危险或不完整地址放入命令：%s", (address) => {
    const guide = buildPublicToolServerGuide(address, toolId);
    expect(guide.ok).toBe(false);
    expect(guide).not.toHaveProperty("endpoint");
    expect(guide).not.toHaveProperty("curlPost");
    if (!guide.ok) expect(guide.error).not.toContain("private");
  });

  it.each(["", "not-a-tool", "../another-tool"])("工具标识必须沿用共享契约：%s", (id) => {
    expect(buildPublicToolServerGuide("https://example.com", id).ok).toBe(false);
  });

  it("请求文件只有待填写的UUID和空结构，不制造业务内容或可直接误用的请求", () => {
    const guide = buildPublicToolServerGuide("https://example.com", toolId);
    if (!guide.ok) throw new Error(guide.error);
    const request = JSON.parse(guide.requestJson);
    expect(request).toEqual({ requestId: SERVER_GUIDE_REQUEST_ID, input: {} });
    expect(PublicToolCallInput.safeParse(request).success).toBe(false);
    expect(PublicToolCallInput.safeParse({ ...request, requestId: toolId }).success).toBe(true);
  });

  it("提交与查询各一次，凭据只从环境变量进入请求头，不自动重试、轮询或追随重定向", () => {
    const guide = buildPublicToolServerGuide("https://example.com", toolId);
    if (!guide.ok) throw new Error(guide.error);
    expect(guide.curlPost).toContain("--request POST");
    expect(guide.curlPost).toContain("--data-binary '@request.json'");
    expect(guide.curlGet).toContain("--request GET");
    expect(guide.curlGet).toContain("PUBLIC_TOOL_REQUEST_ID");
    expect(guide.curlGet).not.toContain("--data");
    for (const command of [guide.curlPost, guide.curlGet]) {
      expect(command).toContain("Authorization: Bearer ${PUBLIC_TOOL_TOKEN:");
      expect(command).not.toMatch(/--retry|--location|\s-L\s|pat_[a-f0-9]{64}/u);
    }
    expect(guide.nodePost).toContain('method: "POST"');
    expect(guide.nodePost).toContain("body: JSON.stringify(request)");
    expect(guide.nodeGet).toContain('method: "GET"');
    expect(guide.nodeGet).toContain("encodeURIComponent(request.requestId)");
    expect(guide.nodeGet).not.toContain("body:");
    for (const code of [guide.nodePost, guide.nodeGet]) {
      expect(code.match(/await fetch\(/gu)).toHaveLength(1);
      expect(code).toContain('redirect: "error"');
      expect(code).toContain("process.env.PUBLIC_TOOL_TOKEN");
      expect(code).toContain('new URL("./request.json", import.meta.url)');
      expect(code).not.toMatch(/randomUUID|setInterval|while\s*\(|Origin:|localStorage|sessionStorage/u);
    }
  });
});
