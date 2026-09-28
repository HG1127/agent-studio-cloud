import { expect, test } from "@playwright/test";

test("从发布中心进入网页工具并核对真实正式版本", async ({ page }) => {
  await page.goto("/releases");
  await page.locator("main").getByRole("link", { name: "网页工具" }).click();
  await expect(page).toHaveURL(/\/web-tools$/);
  await expect(page.getByRole("heading", { level: 1, name: "网页工具" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前不能发布网页工具" })).toBeVisible();
  await expect(page.locator("main").getByText(/不会生成网址或密钥/)).toBeVisible();
  const source = page.getByRole("combobox", { name: "用于核对的助手版本" });
  if (await source.count()) {
    const options = source.locator("option:not([disabled])");
    await expect(options.first()).toBeAttached();
    const first = await options.first().getAttribute("value");
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    await source.selectOption(first!);
    await page.getByRole("button", { name: "核对版本字段" }).click();
    await expect(page).toHaveURL(new RegExp(`/web-tools\\?version=${first}$`));
    await expect(page.getByRole("heading", { name: "业务输入" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "交付字段" })).toBeVisible();
    const preview = page.getByRole("region", { name: "网页填写预览" });
    await expect(preview).toBeVisible();
    if (await preview.getByRole("button", { name: "检查填写格式" }).count()) {
      const previewUrl = page.url();
      await preview.getByRole("button", { name: "检查填写格式" }).click();
      await expect(preview.getByRole("status")).toBeVisible();
      await expect(page).toHaveURL(previewUrl);
      await preview.getByRole("button", { name: "清空试填" }).click();
      await expect(preview.getByRole("status")).toHaveCount(0);
    }
    await expect(page.locator("main").getByRole("link", { name: "查看助手版本" })).toHaveAttribute("href", /^\/agents\/[0-9a-f-]{36}#versions$/i);
  } else {
    await expect(page.getByText(/当前没有可核对的正式版本/)).toBeVisible();
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/web-tools-readiness-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/web-tools");
  await expect(page.getByRole("heading", { level: 1, name: "网页工具" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/web-tools-readiness-mobile.png", fullPage: true });
});

test("外部工具连接明确分离登记清单与协议连接且手机端可用", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/connections");
  await expect(page.getByRole("heading", { level: 1, name: "外部工具连接" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接与工具不是同一件事" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接与握手" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "发现与复核" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "授权与运行" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "业务工具目录" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/external-connections-mobile.png", fullPage: true });
});

test("正式版本页正常或等待较久时均给出明确反馈", async ({ page }) => {
  await page.goto("/web-tools", { waitUntil: "commit" });
  const loaded = page.getByRole("heading", { level: 1, name: "网页工具" });
  const loading = page.getByRole("main", { name: "正在核对正式版本" });
  const slowNotice = loading.getByRole("alert");
  await expect(loaded.or(loading)).toBeVisible();
  if (await loading.isVisible()) {
    await expect(loaded.or(slowNotice)).toBeVisible({ timeout: 30_000 });
    if (await slowNotice.isVisible()) {
      await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
      if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/web-tools-slow-load.png", fullPage: true });
    }
  }
});
