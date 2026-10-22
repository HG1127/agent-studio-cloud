import { expect, test, type Page, type Response as BrowserResponse } from "@playwright/test";
import { McpConnectionConfigurationResult } from "../../src/contracts/mcp-connection";

const configurationPath = "/api/mcp/connections/configuration";
const statusText = {
  configured: "已配置",
  "partially-configured": "部分配置需要处理",
  "not-configured": "尚未登记连接",
  "configuration-error": "配置错误",
} satisfies Record<McpConnectionConfigurationResult["status"], string>;

function waitForRead(page: Page) {
  return page.waitForResponse(async (response) => new URL(response.url()).pathname === configurationPath
    && response.request().method() === "GET" && await response.finished() === null);
}
async function readResponse(response: BrowserResponse): Promise<McpConnectionConfigurationResult> {
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const parsed = McpConnectionConfigurationResult.safeParse(await response.json());
  expect(parsed.success, "真实配置响应必须符合共享契约").toBe(true);
  if (!parsed.success) throw new Error("真实配置响应未通过共享契约");
  return parsed.data;
}
async function expectSnapshot(page: Page, snapshot: McpConnectionConfigurationResult) {
  const region = page.getByRole("region", { name: "连接配置状态" });
  await expect(region).toHaveAttribute("aria-busy", "false");
  await expect(region.getByRole("heading", { name: statusText[snapshot.status], exact: true })).toBeVisible();
  const passed = snapshot.connections.filter((connection) => connection.status === "configured").length;
  if (snapshot.status === "configuration-error" && snapshot.connections.length === 0) {
    await expect(region).toContainText("登记条目清单无法核对，数量未知");
    await expect(region).not.toContainText(/当前配置快照共|配置通过 0 项|配置错误 0 项/);
  } else {
    await expect(region).toContainText(`当前配置快照共 ${snapshot.connections.length} 项登记条目：配置通过 ${passed} 项 · 配置错误 ${snapshot.connections.length - passed} 项。`);
    await expect(region).not.toContainText("登记条目清单无法核对，数量未知");
  }
  if (snapshot.connections.length) {
    const items = region.getByRole("list", { name: "配置诊断登记条目" }).getByRole("listitem");
    await expect(items).toHaveCount(snapshot.connections.length);
    for (const [index, connection] of snapshot.connections.entries()) {
      await expect(items.nth(index).getByRole("heading", { name: connection.name, exact: true })).toBeVisible();
      await expect(items.nth(index)).toContainText(connection.status === "configured" ? "配置通过；尚未检查远端服务。" : "配置错误，请联系管理员核对服务端登记。");
    }
  } else await expect(region.getByRole("list")).toHaveCount(0);
  if (snapshot.status === "configuration-error" && snapshot.connections.length === 0) await expect(region).toContainText("这不代表尚未登记连接");
  await expect(region).toContainText("仅核对服务端本地登记声明");
  await expect(region).toContainText("配置通过不代表远端在线、获得业务授权或工具调用成功");
  await expect(region).toContainText("此配置快照与下方连接检查分别读取，不自动合并结果");
  await expect(region.getByRole("button")).toHaveCount(1);
  await expect(region.getByRole("button", { name: "重新读取配置" })).toBeEnabled();
}

test("桌面配置诊断监听真实GET后按实际枚举展示，手动重读不检查连接或调用工具", async ({ page }, testInfo) => {
  const reads: string[] = [];
  const writes: Array<{ method: string; path: string }> = [];
  const forbiddenChecks: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === configurationPath) {
      expect(request.method()).toBe("GET");
      reads.push(pathname);
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push({ method: request.method(), path: pathname });
    if (pathname === "/api/mcp/connections/check" || /\/api\/(?:mcp|tools)\/.*(?:call|execute|invoke|discover)/.test(pathname)) forbiddenChecks.push(pathname);
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const initialResponse = waitForRead(page);
  await page.goto("/connections");
  const initial = await readResponse(await initialResponse);
  await expectSnapshot(page, initial);
  const configuration = page.getByRole("region", { name: "连接配置状态" });
  const checks = page.getByRole("region", { name: "已登记连接检查" });
  await expect(checks).toBeVisible();
  const positions = await Promise.all([configuration.boundingBox(), checks.boundingBox()]);
  expect(positions[0]).not.toBeNull();
  expect(positions[1]).not.toBeNull();
  expect(positions[0]!.y + positions[0]!.height).toBeLessThanOrEqual(positions[1]!.y);
  const initialReads = reads.length;
  const rereadResponse = waitForRead(page);
  await configuration.getByRole("button", { name: "重新读取配置" }).click();
  const next = await readResponse(await rereadResponse);
  await expectSnapshot(page, next);
  expect(reads).toHaveLength(initialReads + 1);
  expect(writes).toEqual([]);
  expect(forbiddenChecks).toEqual([]);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await testInfo.attach("真实配置只读边界", { body: JSON.stringify({ initialStatus: initial.status, initialEntries: initial.connections.length, rereadStatus: next.status, rereadEntries: next.connections.length, configurationReads: reads.length, writes, checksOrToolInvocations: forbiddenChecks }), contentType: "application/json" });
});
