import { expect, test } from "@playwright/test";

test("验收中心对真实候选样例先确认，取消不启动验收", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/acceptance", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "验收中心" })).toBeVisible();
  let run = page.getByRole("button", { name: /^(验收全部样例|重新验收)$/ }).first();
  for (let checkedPage = 1; checkedPage < 5 && !(await run.isVisible()); checkedPage += 1) {
    const next = page.getByRole("navigation", { name: "验收中心翻页" }).getByRole("link", { name: "下一页" });
    if (!(await next.isVisible())) break;
    await next.click();
    run = page.getByRole("button", { name: /^(验收全部样例|重新验收)$/ }).first();
  }
  test.skip(!(await run.isVisible()), "当前真实数据没有同时具备候选版本和已启用样例的助手");
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: "qa/acceptance-direct-run-mobile.png", fullPage: true });
    await run.locator("xpath=ancestor::li[1]").screenshot({ path: "qa/acceptance-candidate-card-mobile.png" });
  }
  await run.click();
  const dialog = page.getByRole("dialog", { name: "运行全部验收样例？" });
  await expect(dialog).toContainText("可能自动上线");
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: "qa/acceptance-direct-confirm-mobile.png", fullPage: true });
    await dialog.screenshot({ path: "qa/acceptance-confirm-dialog-mobile.png" });
  }
  await dialog.getByRole("button", { name: "返回" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(run).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
