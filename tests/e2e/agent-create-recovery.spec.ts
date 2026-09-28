import { expect, test } from "@playwright/test";

test("创建结果待核对时跨刷新保留原请求，确认后才允许修改", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents/new");
  await page.evaluate(() => {
    sessionStorage.setItem("agent-studio:create-agent-request", JSON.stringify({
      formatVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000099",
      name: "浏览器恢复核对助手",
      intentText: "收到客户咨询后整理资料并生成可审核的回复方案",
    }));
  });
  await page.reload();

  await expect(page.getByText("上次创建结果待核对")).toBeVisible();
  await expect(page.getByLabel("助手名称")).toHaveValue("浏览器恢复核对助手");
  await expect(page.getByLabel("助手名称")).toBeDisabled();
  await expect(page.getByRole("button", { name: "核对上次创建" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "放弃核对并继续修改" }).click();
  const dialog = page.getByRole("dialog", { name: "放弃核对上次创建？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "关闭确认弹窗" }).click();
  await expect(page.getByLabel("助手名称")).toBeDisabled();
  await page.getByRole("button", { name: "放弃核对并继续修改" }).click();
  await dialog.getByRole("button", { name: "继续修改" }).click();
  await expect(page.getByLabel("助手名称")).toBeEnabled();
  await expect(page.getByRole("button", { name: "创建助手" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("agent-studio:create-agent-request"))).toBeNull();
});
