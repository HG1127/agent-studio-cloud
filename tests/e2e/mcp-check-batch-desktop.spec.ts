import { expect, test } from "@playwright/test";
import { McpConnectionCheckInput, McpConnectionCheckResult, McpConnectionListResult, type McpConnectionStatus, type McpConnectionView } from "../../src/contracts/mcp-connection";

const connections = McpConnectionListResult.parse({ connections: [
  { id: "company.lookup", name: "客户查询" },
  { id: "company.update", name: "客户更新" },
  { id: "company.archive", name: "客户归档" },
] }).connections;
function checked(connection: McpConnectionView, status: McpConnectionStatus = "available") {
  return McpConnectionCheckResult.parse({ status, message: "安全检查说明", tools: status === "available" || status === "definition-changed"
    ? [{ registryToolId: connection.id, name: connection.name, status: status === "available" ? "available" : "missing" }] : [] });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

test("桌面真实连接父页手动串行复核，保留通过、失败与未知且不发业务工具请求", async ({ page }, testInfo) => {
  const first = deferred();
  const submitted: string[] = [];
  const writes: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await page.route("**/api/mcp/connections", (route) => route.fulfill({ json: McpConnectionListResult.parse({ connections }) }));
  await page.route("**/api/mcp/connections/check", async (route) => {
    const input = McpConnectionCheckInput.parse(route.request().postDataJSON());
    expect(route.request().method()).toBe("POST");
    submitted.push(input.connectionId);
    if (input.connectionId === connections[0].id) {
      await first.promise;
      await route.fulfill({ json: checked(connections[0]) });
    } else if (input.connectionId === connections[1].id) await route.fulfill({ json: checked(connections[1], "credentials-rejected") });
    else await route.fulfill({ json: { status: "available", message: "缺少登记定义", tools: [] } });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/connections");
  const region = page.getByRole("region", { name: "已登记连接检查" });
  await expect(region).toContainText("当前已读取 3 项登记条目");
  expect(submitted).toEqual([]);
  await region.getByRole("button", { name: "检查全部已登记条目" }).click();
  await expect(region).toContainText("正在逐项检查，每次只安排一项");
  await expect.poll(() => submitted).toEqual([connections[0].id]);
  await expect(region.getByRole("button", { name: "检查客户更新的连接与工具目录" })).toBeDisabled();
  first.resolve();
  await expect(region).toContainText("本次已结束 3 / 3 项检查");
  await expect(region).toContainText("通过 1 项 · 未通过 1 项 · 尚无法判断 1 项");
  await expect(region).toContainText("连接与工具定义检查通过");
  await expect(region).toContainText("服务拒绝了访问凭据");
  await expect(region).toContainText("本次检查结果未取得");
  expect(submitted).toEqual(connections.map((connection) => connection.id));
  await expect(region).toContainText("条目数量不代表独立服务器数量");
  await expect(region).toContainText("检查不执行业务工具，也不修改授权");
  await expect(region).not.toContainText(/company\.|workspace|available|MCP/);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(writes).toEqual(connections.map(() => "/api/mcp/connections/check"));
  await testInfo.attach("登记条目手动逐项复核边界", { body: JSON.stringify({ submitted, writes, businessToolsInvoked: false }), contentType: "application/json" });
});

test("停止只阻止后续安排，当前请求回复仍保存并在回复后恢复手动入口", async ({ page }) => {
  const first = deferred();
  const submitted: string[] = [];
  await page.route("**/api/mcp/connections", (route) => route.fulfill({ json: { connections } }));
  await page.route("**/api/mcp/connections/check", async (route) => {
    const { connectionId } = McpConnectionCheckInput.parse(route.request().postDataJSON());
    submitted.push(connectionId);
    if (connectionId === connections[0].id) await first.promise;
    const connection = connections.find((item) => item.id === connectionId)!;
    await route.fulfill({ json: checked(connection, connectionId === connections[0].id ? "definition-changed" : "available") });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/connections");
  const region = page.getByRole("region", { name: "已登记连接检查" });
  const all = region.getByRole("button", { name: "检查全部已登记条目" });
  await all.click();
  await expect.poll(() => submitted).toEqual([connections[0].id]);
  await region.getByRole("button", { name: "停止安排后续检查" }).click();
  await expect(region).toContainText("当前已发请求仍在等待回复");
  await expect(all).toBeDisabled();
  await expect(region.getByRole("button", { name: "检查客户更新的连接与工具目录" })).toBeDisabled();
  expect(submitted).toEqual([connections[0].id]);
  first.resolve();
  await expect(all).toBeEnabled();
  await expect(region).toContainText("工具目录或字段定义已变化");
  await expect(region).toContainText("本次已结束 1 / 3 项检查");
  await expect(region).toContainText("通过 0 项 · 未通过 1 项 · 尚无法判断 2 项");
  expect(submitted).toEqual([connections[0].id]);
  await region.getByRole("button", { name: "检查客户更新的连接与工具目录" }).click();
  await expect(region).toContainText("通过 1 项 · 未通过 1 项 · 尚无法判断 1 项");
  expect(submitted).toEqual([connections[0].id, connections[1].id]);
});

test("目录归属甲到乙再到甲后，迟到回复不污染新清单或继续旧批量", async ({ page }) => {
  const old = deferred();
  const replyAttempt = deferred();
  let reads = 0;
  const submitted: string[] = [];
  await page.route("**/api/mcp/connections", (route) => {
    reads += 1;
    return route.fulfill({ json: { connections: reads === 2 ? [{ id: connections[0].id, name: "另一归属查询" }] : connections } });
  });
  await page.route("**/api/mcp/connections/check", async (route) => {
    submitted.push(McpConnectionCheckInput.parse(route.request().postDataJSON()).connectionId);
    await old.promise;
    await route.fulfill({ json: checked(connections[0]) }).catch(() => undefined);
    replyAttempt.resolve();
  });
  await page.goto("/connections");
  const region = page.getByRole("region", { name: "已登记连接检查" });
  await region.getByRole("button", { name: "检查全部已登记条目" }).click();
  await expect.poll(() => submitted).toEqual([connections[0].id]);
  await expect(region).toContainText("正在逐项检查");
  await region.getByRole("button", { name: "重新读取目录" }).click();
  await expect(region.getByRole("heading", { name: "另一归属查询" })).toBeVisible();
  await region.getByRole("button", { name: "重新读取目录" }).click();
  await expect(region.getByRole("heading", { name: "客户查询", exact: true })).toBeVisible();
  old.resolve();
  await replyAttempt.promise;
  await expect(region).toContainText("通过 0 项 · 未通过 0 项 · 尚无法判断 3 项");
  await expect(region).not.toContainText("连接与工具定义检查通过");
  expect(submitted).toEqual([connections[0].id]);
  expect(reads).toBe(3);
});

test("长中文名称、加载、读取失败和空目录完整呈现，恢复只读目录", async ({ page }) => {
  const directory = deferred();
  let reads = 0;
  const submitted: string[] = [];
  const longConnection = McpConnectionListResult.parse({ connections: [{ id: "company.long", name: "查看本企业跨多个业务部门的客户登记与处理约定以及相关资料输入字段核对服务" }] }).connections[0];
  await page.route("**/api/mcp/connections", async (route) => {
    reads += 1;
    if (reads === 1) { await directory.promise; await route.fulfill({ status: 500, json: { error: "private-detail" } }); }
    else await route.fulfill({ json: { connections: reads === 2 ? [longConnection] : [] } });
  });
  await page.route("**/api/mcp/connections/check", async (route) => { submitted.push(McpConnectionCheckInput.parse(route.request().postDataJSON()).connectionId); await route.fulfill({ status: 500, json: {} }); });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/connections");
  const region = page.getByRole("region", { name: "已登记连接检查" });
  await expect(region).toContainText("正在读取已登记连接");
  await expect(region.getByRole("button", { name: "检查全部已登记条目" })).toHaveCount(0);
  directory.resolve();
  await expect(region.getByRole("alert")).toContainText("当前不能判断是否有已登记连接");
  await expect(region).not.toContainText("private-detail");
  await region.getByRole("button", { name: "重新读取目录" }).click();
  await expect(region.getByRole("heading", { name: longConnection.name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await region.getByRole("button", { name: "重新读取目录" }).click();
  await expect(region).toContainText("当前没有可供检查的已登记连接");
  await expect(region.getByRole("button", { name: "检查全部已登记条目" })).toHaveCount(0);
  expect(submitted).toEqual([]);
});
