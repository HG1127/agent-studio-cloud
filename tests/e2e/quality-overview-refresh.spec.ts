import { expect, test } from "@playwright/test";

test("验收与发布中心可重新读取当前筛选，空页能返回上一页", async ({ page }) => {
  const query = "不存在的验收助手";
  for (const [pathname, title, width] of [
    ["/acceptance", "验收中心", 1280],
    ["/releases", "发布中心", 390],
  ] as const) {
    await page.setViewportSize({ width, height: 800 });
    const params = new URLSearchParams({ q: query, page: "2" });
    const href = `${pathname}?${params}`;
    await page.goto(href, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(/当前页没有验收记录|当前页没有发布记录/)).toBeVisible();
    const previous = page.getByRole("link", { name: "返回上一页" });
    await expect(previous).toHaveAttribute("href", `${pathname}?q=${encodeURIComponent(query)}`);
    await page.getByRole("button", { name: "重新读取状态" }).click();
    await expect(page).toHaveURL(new RegExp(`/${pathname.slice(1)}\\?q=.*&page=2$`));
    await previous.click();
    await expect(page).toHaveURL(new RegExp(`/${pathname.slice(1)}\\?q=.*$`));
    await expect(page.getByRole("searchbox", { name: "搜索助手" })).toHaveValue(query);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
