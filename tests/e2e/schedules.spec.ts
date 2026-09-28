import { expect, test } from "@playwright/test";

const AUDIT_DIR = "qa/audit-2026-09-27-schedules";

test("定时任务以状态优先呈现，并可安全预览创建计划", async ({ page }) => {
  await page.goto("/schedules");
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务总览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "自动运行记录" })).toHaveAttribute("href", "/runs?source=schedule");
  await expect(page.getByText("时间口径：北京时间（UTC+8）")).toBeVisible();
  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page).toHaveURL(/\/schedules$/);
  await expect(page.getByRole("heading", { name: "任务总览" })).toBeVisible();

  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/03-final-desktop.png`, fullPage: true });

  const create = page.getByRole("button", { name: "新建定时任务" });
  if (await create.isEnabled()) {
    await create.click();
    const dialog = page.getByRole("dialog", { name: "新建定时任务" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^当前显示：正式版本 V\d+$/)).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "保存后会这样运行" })).toBeVisible();
    await expect(dialog.getByText(/自动运行使用执行时的正式版本/)).toBeVisible();
    await dialog.getByRole("button", { name: /^每周/ }).click();
    await expect(dialog.getByText("运行日")).toBeVisible();
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/04-final-create-panel.png`, fullPage: true });
    await dialog.getByRole("button", { name: "关闭创建面板" }).click();
    await expect(dialog).toBeHidden();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedules");
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/05-final-mobile.png`, fullPage: true });
  if (await page.getByRole("button", { name: "新建定时任务" }).isEnabled()) {
    await page.getByRole("button", { name: "新建定时任务" }).click();
    const dialog = page.getByRole("dialog", { name: "新建定时任务" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(390);
    const openWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(openWidth.scroll).toBeLessThanOrEqual(openWidth.client);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/06-final-mobile-create-panel.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/schedules");
  await expect(page.getByRole("heading", { name: "定时任务", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务总览" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新读取状态" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
