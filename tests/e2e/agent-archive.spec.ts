import { expect, test } from "@playwright/test";

test("手机端停用助手前说明定时任务后果，取消后不提交", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  await expect(page.getByRole("heading", { level: 1, name: "我的助手" })).toBeVisible();
  const active = page.getByRole("region", { name: "在用助手" });
  const first = active.getByRole("listitem").first();
  test.skip(await first.count() === 0, "当前工作区没有在用助手");

  await first.getByRole("button", { name: "停用" }).click();
  const dialog = page.getByRole("dialog", { name: /停用「.+」？/ });
  await expect(dialog).toContainText("关联的定时任务会暂停");
  await expect(dialog).toContainText("恢复助手不会自动恢复这些定时任务");
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/agent-archive-confirm-mobile.png", fullPage: true });
  await dialog.getByRole("button", { name: "返回" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(first.getByRole("button", { name: "停用" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("查找不到助手时区分筛选为空与工作区为空", async ({ page }) => {
  await page.goto(`/agents?q=${encodeURIComponent(`不存在的助手-${Date.now()}`)}`);
  await expect(page.getByRole("heading", { level: 1, name: "我的助手" })).toBeVisible();
  const active = page.getByRole("region", { name: "在用助手" });
  await expect(active.getByText("没有找到匹配的在用助手")).toBeVisible();
  await expect(active.getByRole("link", { name: "查看全部助手" })).toHaveAttribute("href", "/agents");
  await expect(active.getByText("还没有助手，创建第一个吧")).toHaveCount(0);
});
