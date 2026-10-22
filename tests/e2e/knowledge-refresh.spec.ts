import { expect, test } from "@playwright/test";

test("手机端核对资料状态保留文件名查找，空页可返回上一页", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const query = `不存在的资料-${Date.now()}`;
  await page.goto(`/knowledge?source=${encodeURIComponent(query)}&page=2`);
  await expect(page.getByRole("heading", { level: 1, name: "资料与应用" })).toBeVisible();
  const sources = page.getByRole("region", { name: "公司资料" });
  await expect(sources.getByText("当前页没有匹配的资料。")).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "按文件名查找资料" })).toHaveValue(query);

  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?source=${encodeURIComponent(query)}&page=2$`));
  await expect(sources.getByText("当前页没有匹配的资料。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await sources.getByRole("link", { name: "返回上一页" }).click();
  await expect(page).toHaveURL(new RegExp(`\\?source=${encodeURIComponent(query)}$`));
  await expect(sources.getByText(/没有找到匹配的资料/)).toBeVisible();
});
