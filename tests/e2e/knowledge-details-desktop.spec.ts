import { expect, test } from "@playwright/test";

test("桌面资料详情核对真实记录、重新读取和焦点返回，不提交资料操作", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await page.goto("/knowledge");
  const sources = page.getByRole("region", { name: "公司资料", exact: true });
  await expect(sources).toBeVisible();
  const record = sources.getByRole("listitem").first();
  await expect(record, "详情验证需要真实已有资料，不使用演示记录或静态填充").toBeAttached();
  const filename = await record.locator("p").first().innerText();
  const count = (await record.innerText()).match(/· (\d+) 段 ·/u)?.[1];
  expect(count).toBeTruthy();
  const original = await record.getByRole("link", { name: "下载原文件" }).count() ? await record.getByRole("link", { name: "下载原文件" }).getAttribute("href") : null;
  const trigger = record.getByRole("button", { name: "查看资料", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "资料记录详情" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(filename);
  await expect(dialog.getByText(`${Number(count).toLocaleString("zh-CN")} 段`, { exact: true })).toBeVisible();
  await expect(dialog.getByText("已记录的字符数", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("不是全文预览");
  if (original) await expect(dialog.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", original);
  else await expect(dialog.getByRole("link", { name: "下载原文件" })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "核对助手资料范围" })).toHaveAttribute("href", "/agents");
  const currentUrl = page.url();
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/knowledge" && response.request().headers()["rsc"] === "1");
  await dialog.getByRole("button", { name: "重新读取状态" }).click();
  expect((await refreshed).ok()).toBe(true);
  await expect(dialog.getByRole("button", { name: "重新读取状态" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "重新读取状态" })).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(currentUrl);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(filename);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await dialog.boundingBox();
    expect(bounds).toBeTruthy();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(dialog.getByRole("button", { name: "关闭详情" })).toBeVisible();
  }
  for (let index = 0; index < 7; index++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/knowledge-source-details-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([]);
});

test("桌面资料检索保留文件名和独立页码，重新读取及空页返回不写入", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  const source = `不存在的桌面资料-${Date.now()}`;
  const query = `不存在的桌面业务词-${Date.now()}`;
  const params = new URLSearchParams({ source, page: "2", archivedPage: "3" });
  await page.goto(`/knowledge?${params}`);
  const active = page.getByRole("region", { name: "公司资料", exact: true });
  const archived = page.getByRole("region", { name: "已归档资料", exact: true });
  await expect(active.getByText("当前页没有匹配的资料。", { exact: true })).toBeVisible();
  await expect(archived.getByText("当前页没有匹配的资料。", { exact: true })).toBeVisible();
  const search = page.getByRole("region", { name: "验证资料检索" });
  await search.getByRole("textbox", { name: "检索关键词" }).fill(query);
  await search.getByRole("button", { name: "开始检索" }).click();
  await expect(search.getByRole("status")).toContainText("没有找到相关内容");
  for (const [name, value] of Object.entries({ source, page: "2", archivedPage: "3", q: query })) expect(new URL(page.url()).searchParams.get(name)).toBe(value);
  const currentUrl = page.url();
  const refreshed = page.waitForResponse((response) => new URL(response.url()).pathname === "/knowledge" && response.request().headers()["rsc"] === "1");
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  expect((await refreshed).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "重新读取状态", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "重新读取状态", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(currentUrl);
  await expect(search.getByRole("textbox", { name: "检索关键词" })).toHaveValue(query);
  await expect(page.getByRole("searchbox", { name: "按文件名查找资料" })).toHaveValue(source);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: "qa/knowledge-search-pagination-desktop.png", fullPage: true }); }
  await active.getByRole("link", { name: "返回上一页" }).click();
  await expect(active.getByText(/没有找到匹配的资料/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("archivedPage")).toBe("3");
  expect(new URL(page.url()).searchParams.get("q")).toBe(query);
  expect(new URL(page.url()).searchParams.get("source")).toBe(source);
  expect(new URL(page.url()).searchParams.has("page")).toBe(false);
  expect(writes).toEqual([]);
});
