import { expect, test } from "@playwright/test";

test("手机端恢复定时创建待核对状态，明确确认前不会重复提交", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/schedules");
  const create = page.getByRole("button", { name: "新建定时任务" });
  test.skip(!(await create.isEnabled()), "当前工作区没有已发布的助手");
  await page.evaluate(() => sessionStorage.setItem("agent-studio:schedule-create-pending", JSON.stringify({
    formatVersion: 1,
    agentName: "合同审核助手",
    summary: "每天 09:00",
    submittedAt: "2026-09-28T00:00:00.000Z",
  })));
  await page.reload();
  await page.getByRole("button", { name: "新建定时任务" }).click();
  const dialog = page.getByRole("dialog", { name: "新建定时任务" });
  await expect(dialog.getByRole("region", { name: "上次创建结果待核对" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "创建并启用" })).toBeDisabled();
  await dialog.getByRole("button", { name: "已核对，准备新建另一条" }).click();
  await dialog.getByRole("button", { name: "继续核对" }).click();
  await expect(dialog.getByRole("button", { name: "创建并启用" })).toBeDisabled();
  await dialog.getByRole("button", { name: "已核对，准备新建另一条" }).click();
  await dialog.getByRole("button", { name: "确认风险，允许重新创建" }).click();
  await expect(dialog.getByRole("button", { name: "创建并启用" })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem("agent-studio:schedule-create-pending"))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
