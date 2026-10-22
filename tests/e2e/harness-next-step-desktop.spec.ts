import { expect, test } from "@playwright/test";

test("桌面诊断的真实状态入口到处理区并返回所选任务", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/harness");
  await expect(page.getByRole("heading", { name: "运行控制台" })).toBeVisible();
  const runLinks = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link");
  expect(await runLinks.count(), "桌面诊断验收需要实际可读取的运行记录").toBeGreaterThan(0);
  const href = await runLinks.first().getAttribute("href");
  expect(href).toMatch(/^\/harness\?run=[0-9a-f-]{36}$/i);
  await runLinks.first().click();
  await expect(page).toHaveURL(new RegExp(href!.replace("?", "\\?") + "$"));
  const nextStep = page.getByRole("region", { name: "本次任务的下一步" });
  await expect(nextStep).toBeVisible();
  await expect(nextStep.getByText(/只打开任务详情，不提交动作/)).toBeVisible();
  const action = nextStep.getByRole("link").first();
  const detailHref = await action.getAttribute("href");
  const detail = new URL(detailHref!, page.url());
  expect(detail.searchParams.get("from")).toBe(href);
  expect(["#run-controls", "#run-waiting", "#trace", "#result", "#run-failure"]).toContain(detail.hash);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await nextStep.screenshot({ path: "qa/harness-next-step-desktop.png" });
  await action.click();
  await expect(page).toHaveURL(detail.href);
  await expect(page.locator(detail.hash)).toBeVisible();
  const back = page.getByRole("link", { name: "返回运行控制台" });
  await expect(back).toHaveAttribute("href", href!);
  await back.click();
  await expect(page).toHaveURL(new URL(href!, detail.href).href);
  await expect(page.getByRole("navigation", { name: "选择诊断任务" }).locator('[aria-current="page"]')).toHaveAttribute("href", href!);
  await expect(page.getByRole("heading", { name: "执行轨迹" })).toBeVisible();
});

test("桌面无效诊断链接保持明确空状态，不自动换到另一任务", async ({ page }) => {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/harness?run=not-a-run");
    await expect(page.getByRole("heading", { name: "找不到这次运行" })).toBeVisible();
    await expect(page.getByRole("region", { name: "本次任务的下一步" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "前往运行记录" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
