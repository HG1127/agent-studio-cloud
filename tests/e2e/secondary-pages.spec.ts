import { expect, test } from "@playwright/test";

test("手机端操作记录与管理设置保持清晰的页面层级", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/activity");
  await expect(page.getByRole("heading", { level: 1, name: "操作记录" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "记录类型" })).toBeVisible();
  await expect(page.getByRole("button", { name: "筛选" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/secondary-pages-activity-mobile.png", fullPage: true });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "管理设置" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "模型连接" })).toBeVisible();
  await expect(page.getByRole("link", { name: /定时任务/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/secondary-pages-settings-mobile.png", fullPage: true });
});

test("手机端模型连接按需打开表单，删除前确认且取消不写入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const addConnection = page.getByRole("button", { name: "添加模型连接" });
  test.skip(!(await addConnection.isVisible()), "真实模型功能未开放");

  await expect(page.getByRole("heading", { name: "已接入的模型服务" })).toBeVisible();
  const firstModelTest = page.getByRole("button", { name: /^测试「.+」的首个模型$/ }).first();
  if (await firstModelTest.count()) {
    await expect(firstModelTest).toBeVisible();
    await expect(firstModelTest.locator("xpath=../..")).toContainText("当前测试只检查首个模型");
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/model-connections-mobile-list.png", fullPage: true });
  await addConnection.click();
  const drawer = page.getByRole("dialog", { name: "添加模型连接" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByLabel("连接名称")).toBeVisible();
  await expect(drawer.getByLabel("密钥")).toBeVisible();
  await expect(drawer.getByLabel("模型列表")).toHaveAttribute("aria-describedby", "model-list-help");
  await expect(drawer.getByText("当前测试只检查列表中的第一个模型；其他模型的可用性请在实际使用前核对。")).toBeVisible();
  await expect(drawer.getByText(/设为默认不代表已通过测试/)).toBeVisible();
  if (process.env.CAPTURE_MODEL_SCOPE === "1") await drawer.screenshot({ path: "qa/model-connection-test-scope-mobile.png" });
  await expect(drawer.getByRole("button", { name: "保存连接" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/model-connections-mobile-drawer.png", fullPage: true });
  await drawer.getByRole("button", { name: "关闭连接面板" }).click();
  await expect(drawer).not.toBeVisible();

  const deleteConnection = page.getByRole("button", { name: /^删除「/ }).first();
  if (await deleteConnection.isVisible()) {
    await deleteConnection.click();
    const confirmation = page.getByRole("dialog", { name: /^删除「/ });
    await expect(confirmation).toContainText("已发布版本将无法运行");
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/model-connections-mobile-delete.png", fullPage: true });
    await confirmation.getByRole("button", { name: "关闭确认弹窗" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(deleteConnection).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("操作记录中的运行反馈可回到真实结果证据", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/activity?type=run");
  await expect(page.getByRole("heading", { level: 1, name: "操作记录" })).toBeVisible();
  const feedbackLink = page.getByRole("link", { name: "查看相关运行反馈" }).first();
  test.skip(!(await feedbackLink.isVisible()), "当前工作区还没有运行反馈操作记录");
  await expect(feedbackLink).toHaveAttribute("href", /^\/runs\/[0-9a-f-]{36}#feedback$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/activity-navigation-mobile.png", fullPage: true });
  await feedbackLink.click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}#feedback$/);
  await expect(page.locator("#feedback")).toBeVisible();
  await expect(page.locator("#feedback").getByRole("heading", { name: "这个结果能直接使用吗？" })).toBeVisible();
  await expect(page.locator("#feedback").getByRole("button", { name: /符合预期/ })).toBeVisible();
  await expect(page.locator("#feedback").getByRole("button", { name: /需要改进/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/run-feedback-mobile.png", fullPage: true });
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.locator("#feedback").screenshot({ path: "qa/run-feedback-mobile-panel.png" });
});
