import { expect, test } from "@playwright/test";

const AUDIT_DIR = "qa/audit-2026-09-27-memory";

test("成长中心展示真实改进反馈和经验来源，不执行写操作", async ({ page }) => {
  await page.goto("/memory");
  await expect(page.getByRole("heading", { level: 1, name: "成长中心" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "待改进结果" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "长期经验" })).toBeVisible();
  await expect(page.getByText(/只供原助手在后续运行中检索/)).toBeVisible();
  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "成长中心" })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/01-desktop.png`, fullPage: true });

  const stop = page.getByRole("button", { name: "停用", exact: true }).first();
  if (await stop.count()) {
    await stop.click();
    const dialog = page.getByRole("dialog", { name: "停用这条经验？" });
    await expect(dialog.getByText(/停用后不再参与后续检索/)).toBeVisible();
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/02-stop-confirmation.png`, fullPage: true });
    await dialog.getByRole("button", { name: "返回" }).click();
  } else {
    await expect(page.getByText("还没有长期经验")).toBeVisible();
  }

  await page.getByRole("textbox", { name: "内容关键词" }).fill("这个经验肯定不存在-20260927");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(page.getByText("没有符合筛选条件的经验")).toBeVisible();
  await expect(page.getByRole("link", { name: "清除筛选" })).toBeVisible();
  const filteredUrl = page.url();
  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page.getByText("没有符合筛选条件的经验")).toBeVisible();
  expect(page.url()).toBe(filteredUrl);
});

test("成长中心先说明验收样例用途，取消时不创建", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memory");
  await expect(page.getByRole("heading", { level: 1, name: "成长中心" })).toBeVisible();
  const add = page.getByRole("button", { name: "加入验收样例" }).first();
  test.skip(!(await add.isVisible()), "当前真实数据没有可加入验收的改进反馈");
  await add.click();
  const dialog = page.getByRole("dialog", { name: "把这次改进意见加入验收？" });
  await expect(dialog).toContainText("还需到助手页补充期望结果和检查条件");
  await dialog.getByRole("button", { name: "返回" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(add).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("成长中心手机端筛选与空状态不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/memory");
  await expect(page.getByRole("heading", { level: 1, name: "成长中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "筛选", exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/03-mobile.png`, fullPage: true });
});
