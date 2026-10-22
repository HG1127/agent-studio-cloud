import { expect, test } from "@playwright/test";

test("发布中心可定位历史稳定版本，取消恢复不会改动正式版本", async ({ page }) => {
  await page.goto("/releases", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: "发布中心" })).toBeVisible();
  let history = page.getByRole("link", { name: "查看历史稳定版本" }).first();
  for (let checkedPage = 1; checkedPage < 5 && !(await history.isVisible()); checkedPage += 1) {
    const next = page.getByRole("navigation", { name: "发布中心翻页" }).getByRole("link", { name: "下一页" });
    if (!(await next.isVisible())) break;
    await next.click();
    history = page.getByRole("link", { name: "查看历史稳定版本" }).first();
  }
  test.skip(!(await history.isVisible()), "当前页没有带历史稳定版本且需要验收的助手");
  await history.click();
  const versions = page.locator("#versions");
  await expect(versions.getByRole("heading", { name: "版本历史" })).toBeVisible();
  const restore = versions.getByRole("button", { name: "恢复为当前版本" }).first();
  test.skip(!(await restore.isEnabled()), "当前助手没有可操作的历史稳定版本");
  const before = await versions.locator("ul > li").count();
  await restore.click();
  const confirmation = page.getByRole("dialog", { name: /恢复历史版本 \d+？/ });
  await expect(confirmation).toContainText("当前正式版本");
  await expect(confirmation).toContainText("已有运行保留原版本");
  await confirmation.getByRole("button", { name: "返回" }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(versions.locator("ul > li")).toHaveCount(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
