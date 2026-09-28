import { expect, test } from "@playwright/test";

test("运行诊断展示真实任务并能往返任务详情", async ({ page }) => {
  await page.goto("/harness");
  await expect(page.getByRole("heading", { name: "运行控制台" })).toBeVisible();
  await expect(page.getByText(/轨迹事件不能代替完整的规则判决/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "尚未接入的运行控制" })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/harness-diagnostics-desktop.png", fullPage: true });

  const runLinks = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link");
  if (await runLinks.count()) {
    const firstHref = await runLinks.first().getAttribute("href");
    expect(firstHref).toMatch(/^\/harness\?run=[0-9a-f-]{36}$/i);
    await runLinks.first().click();
    await expect(page).toHaveURL(/\/harness\?run=[0-9a-f-]{36}$/i);
    await expect(page.getByRole("heading", { name: "已保存的步骤" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "执行轨迹" })).toBeVisible();
    await page.getByRole("button", { name: /需关注 \d+/ }).click();
    await expect(page.getByRole("button", { name: /需关注 \d+/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "打开任务详情" }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/i);
    await page.locator("main").getByRole("link", { name: "运行诊断" }).click();
    await expect(page).toHaveURL(/\/harness\?run=[0-9a-f-]{36}$/i);
  } else {
    await expect(page.getByText("还没有运行记录")).toBeVisible();
  }
});

test("不存在的运行显示诚实空状态，手机端无水平溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/harness?run=00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "找不到这次运行" })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往运行记录" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/harness-diagnostics-mobile.png", fullPage: true });
});
