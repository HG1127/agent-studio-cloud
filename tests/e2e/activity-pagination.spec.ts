import { expect, test } from "@playwright/test";

test("操作记录的空页恢复保留筛选，手机端可重新读取", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const query = "不存在的操作记录测试词20260928";
  const params = new URLSearchParams({ type: "agent", q: query, page: "999" });
  await page.goto(`/activity?${params}`);

  await expect(page.getByRole("heading", { level: 1, name: "操作记录" })).toBeVisible();
  await expect(page.getByText(/不能当作全部安全审计依据/)).toBeVisible();
  await expect(page.getByText("当前页没有操作记录")).toBeVisible();
  await expect(page.getByRole("link", { name: "回到第一页" })).toHaveAttribute("href", `/activity?type=agent&q=${encodeURIComponent(query)}`);
  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page).toHaveURL(/page=999/);
  await page.getByRole("link", { name: "回到第一页" }).click();
  await expect(page.getByText("没有符合筛选条件的操作记录")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "记录类型" })).toHaveValue("agent");
  await expect(page.getByRole("textbox", { name: "操作关键词" })).toHaveValue(query);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_ACTIVITY_PAGE === "1") await page.screenshot({ path: "qa/activity-empty-page-mobile.png", fullPage: true });
});
