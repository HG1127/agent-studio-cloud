import { expect, test, type Page, type Response as BrowserResponse } from "@playwright/test";
import { McpConnectionCheckInput, McpConnectionCheckResult, McpConnectionListResult, type McpConnectionView } from "../../src/contracts/mcp-connection";

const directoryPath = "/api/mcp/connections";
const checkPath = "/api/mcp/connections/check";
function waitForDirectory(page: Page) {
  return page.waitForResponse(async (response) => new URL(response.url()).pathname === directoryPath && response.request().method() === "GET" && await response.finished() === null);
}
async function readDirectory(response: BrowserResponse) {
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const parsed = McpConnectionListResult.safeParse(await response.json());
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw new Error("真实目录响应不符合共享契约");
  expect(new Set(parsed.data.connections.map((connection) => connection.id)).size).toBe(parsed.data.connections.length);
  return parsed.data.connections;
}

test("桌面按真实本页目录的唯一标识手动定位参考字段，不调用远端或业务工具", async ({ page }, testInfo) => {
  let currentDirectory: McpConnectionView[] = [];
  const manualCheckInputs: string[] = [], forbiddenWrites: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && pathname !== checkPath) forbiddenWrites.push(pathname);
    if (/\/api\/(?:mcp|tools)\/.*(?:call|execute|invoke|discover)/.test(pathname)) forbiddenWrites.push(pathname);
  });
  // Only the explicit manual check transport is replaced; the page registry and directory GET stay real.
  await page.route(`**${checkPath}`, async (route) => {
    const request = route.request();
    expect(request.method()).toBe("POST");
    const input = McpConnectionCheckInput.parse(request.postDataJSON());
    const matching = currentDirectory.filter((connection) => connection.id === input.connectionId);
    expect(matching).toHaveLength(1);
    manualCheckInputs.push(input.connectionId);
    const view = matching[0];
    if (!view) throw new Error("没有唯一当前登记条目");
    const reply = McpConnectionCheckResult.parse({ status: "definition-changed", message: "只替换核对读取I/O", tools: [{ registryToolId: view.id, name: view.name, status: "missing" }] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply), headers: { "Cache-Control": "no-store" } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const initialRead = waitForDirectory(page);
  await page.goto("/connections");
  currentDirectory = await readDirectory(await initialRead);
  const checks = page.getByRole("region", { name: "已登记连接检查" });
  await expect(checks).toBeVisible();
  await expect(checks.getByRole("button", { name: /本页登记字段/ })).toHaveCount(0);
  expect(manualCheckInputs).toEqual([]);
  const anchors = await page.locator("li[id^='business-tool-']").evaluateAll((elements) => elements.map((element) => decodeURIComponent(element.id.slice("business-tool-".length))));
  const eligibleIndex = currentDirectory.findIndex((connection) => anchors.filter((id) => id === connection.id).length === 1);
  let located = false;
  if (currentDirectory.length > 0) {
    const index = eligibleIndex < 0 ? 0 : eligibleIndex;
    const view = currentDirectory[index];
    const row = checks.getByRole("list", { name: "当前登记条目检查" }).locator(":scope > li").nth(index);
    await row.getByRole("button", { name: /的连接与工具目录$/ }).click();
    await expect(row).toContainText("目录中未找到");
    await expect(row).toContainText("不能替代实际远端定义或业务授权");
    if (eligibleIndex >= 0) {
      const catalog = page.getByRole("region", { name: "业务工具目录" });
      const button = row.getByRole("button", { name: /的本页登记字段$/ });
      await expect(button).toHaveText("查看本页登记字段");
      await catalog.getByRole("searchbox").fill("不会匹配的筛选内容");
      await catalog.getByRole("button", { name: "高风险", exact: true }).click();
      await button.focus(); await button.press("Enter");
      const target = page.locator(`[id=${JSON.stringify(`business-tool-${encodeURIComponent(view.id)}`)}]`);
      const summary = target.locator(":scope > details > summary");
      await expect(summary).toBeFocused();
      await expect(target.locator(":scope > details")).toHaveAttribute("open", "");
      await expect(catalog.getByRole("searchbox")).toHaveValue("");
      await expect(catalog.getByRole("button", { name: "全部风险" })).toHaveAttribute("aria-pressed", "true");
      await expect(target.getByRole("region", { name: "输入字段约定" })).toBeVisible();
      await expect(target.getByRole("textbox", { name: /登记原定义/ })).toHaveCount(0);
      expect(manualCheckInputs).toEqual([view.id]);
      located = true;
    } else await expect(row.getByRole("button", { name: /本页登记字段/ })).toHaveCount(0);
  }
  const reloadRead = waitForDirectory(page);
  await checks.getByRole("button", { name: "重新读取目录" }).click();
  currentDirectory = await readDirectory(await reloadRead);
  await expect(page.getByText(/连接目录已重新读取，本页原字段说明不再关联/)).toHaveCount(await page.getByRole("region", { name: "业务工具目录" }).count());
  await expect(checks.getByRole("button", { name: /本页登记字段/ })).toHaveCount(0);
  if (currentDirectory.length > 0) {
    const row = checks.getByRole("list", { name: "当前登记条目检查" }).locator(":scope > li").first();
    await row.getByRole("button", { name: /的连接与工具目录$/ }).click();
    await expect(row).toContainText("目录中未找到");
    await expect(row.getByRole("button", { name: /本页登记字段/ })).toHaveCount(0);
  }
  expect(forbiddenWrites).toEqual([]);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await testInfo.attach("本页字段定位边界", { body: JSON.stringify({ initialUniqueCatalogMatch: eligibleIndex >= 0, referenceFieldLocated: located, manualCheckCount: manualCheckInputs.length, checkTransportMocked: true, directoryAndPageRegistryReal: true, businessWrites: forbiddenWrites }), contentType: "application/json" });
});
