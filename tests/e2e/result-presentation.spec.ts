import { expect, test } from "@playwright/test";

const COMPLETED_RUN_ID = "61dd64f8-43e7-43ef-bc77-3345c57cfe5b";

test("真实交付结果在手机端可阅读，原始数据默认收起", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/runs/${COMPLETED_RUN_ID}#result`);

  const result = page.locator("#result");
  await expect(result.getByRole("heading", { name: "最终结果" })).toBeVisible();
  await expect(result.locator("ul > li").first()).toBeVisible();
  await expect(result.locator("ul > li").first()).not.toBeEmpty();
  await expect(result.getByText("查看结果数据（开发者数据）")).toBeVisible();
  await expect(result.locator("details pre")).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  if (process.env.CAPTURE_RESULT_AUDIT === "1") {
    await result.screenshot({ path: "qa/run-result-mobile-presentation.png" });
  }
});
