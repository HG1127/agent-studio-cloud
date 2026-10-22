import { expect, test } from "@playwright/test";

test("手机端刷新助手目录保留查找条件，空页可以返回上一页", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const query = `不存在的助手-${Date.now()}`;
  await page.goto(`/agents?q=${encodeURIComponent(query)}&page=2`);
  await expect(page.getByRole("heading", { level: 1, name: "我的助手" })).toBeVisible();
  const active = page.getByRole("region", { name: "在用助手" });
  await expect(active.getByText("当前页没有匹配的在用助手")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "查找助手" })).toHaveValue(query);

  await page.getByRole("button", { name: "重新读取列表" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(query)}&page=2$`));
  await expect(active.getByText("当前页没有匹配的在用助手")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await active.getByRole("link", { name: "返回上一页" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(query)}$`));
  await expect(active.getByText("没有找到匹配的在用助手")).toBeVisible();
});
