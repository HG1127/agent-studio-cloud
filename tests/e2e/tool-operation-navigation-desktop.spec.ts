import { expect, test } from "@playwright/test";
import { ToolOperationGetResult, ToolOperationListResult } from "../../src/contracts/tool-operation";

test("桌面工具核对实际列表、详情、源任务往返与只读边界", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  const listResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/tool-operations" && response.request().method() === "GET");
  await page.goto("/tool-operations?status=blocked");
  const response = await listResponse;
  expect(response.ok()).toBe(true);
  const list = ToolOperationListResult.parse(await response.json());
  if (!list.ok || list.items.length === 0) throw new Error("需要隔离环境中的真实待核对工具记录；不跳过或注入前端假记录");
  const operation = list.items[0];
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "工具结果核对" })).toHaveAttribute("aria-current", "page");
  const detailResponse = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/tool-operations/" + operation.id && value.request().method() === "GET");
  await page.getByRole("region", { name: "业务核对记录列表" }).getByRole("button", { name: /查看.*的核对记录/ }).first().click();
  const detailHttp = await detailResponse;
  expect(detailHttp.ok()).toBe(true);
  const detail = ToolOperationGetResult.parse(await detailHttp.json());
  if (!detail.ok) throw new Error("实际工具详情读取失败");
  expect(detail.operation.id).toBe(operation.id); expect(detail.operation.sourceRunId).toBe(operation.sourceRunId);
  const source = page.getByRole("link", { name: "查看这条记录的源任务" });
  await expect(source).toHaveAttribute("href", "/runs/" + operation.sourceRunId + "?from=" + encodeURIComponent("/tool-operations?status=blocked"));
  await source.focus(); await expect(source).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp("/runs/" + operation.sourceRunId));
  await page.getByRole("link", { name: "返回工具核对列表" }).click();
  await expect(page).toHaveURL(/\/tool-operations\?status=blocked$/);
  await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "处理记录", exact: true }).click();
  await page.goto("/runs/" + operation.sourceRunId);
  await page.getByRole("link", { name: "业务操作记录" }).click();
  await expect(page).toHaveURL("/tool-operations?sourceRunId=" + operation.sourceRunId);
  await expect(page.getByText("仅查看指定任务的业务记录。")).toBeVisible();
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  const body = await page.locator("main").innerText();
  expect(body).not.toContain(operation.id); expect(body).not.toContain(operation.sourceRunId);
  expect(writes).toEqual([]);
});
