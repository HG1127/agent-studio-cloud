import { expect, test } from "@playwright/test";

test("桌面任务详情重新读取保留筛选返回、真实内容和未保存反馈", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/runs?status=completed");
  const runs = page.locator('main ul li a[href^="/runs/"]');
  expect(await runs.count(), "桌面任务详情验收需要实际已完成的任务").toBeGreaterThan(0);
  const href = await runs.first().getAttribute("href");
  expect(href).toMatch(/^\/runs\/[0-9a-f-]{36}\?from=/i);
  const detailUrl = new URL(href!, page.url()).href;
  await runs.first().click();
  await expect(page).toHaveURL(detailUrl);
  const detailPath = new URL(detailUrl).pathname;
  const back = page.getByRole("link", { name: "返回筛选结果" });
  await expect(back).toHaveAttribute("href", "/runs?status=completed");
  await expect(page.getByRole("button", { name: "重新读取状态" })).toBeEnabled();
  await expect(page.getByRole("complementary", { name: "部分内容读取失败" })).toHaveCount(0);
  const inputBefore = await page.locator("#input").innerText();
  const result = page.locator("#result");
  const resultBefore = await result.count() > 0 ? await result.innerText() : null;
  const navigation = page.getByRole("navigation", { name: "运行详情区块" });
  for (const label of ["执行步骤", "执行轨迹", "确认记录"]) {
    const link = navigation.getByRole("link", { name: label, exact: true });
    const anchor = await link.getAttribute("href");
    await link.click();
    await expect(page.locator(anchor!)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(anchor! + "$"));
  }
  await page.getByRole("button", { name: /需要改进/ }).click();
  const note = page.getByRole("textbox", { name: "结果反馈说明" });
  const originalNote = await note.inputValue();
  const draft = "桌面只读验收：重新读取后仍保留这条未保存意见";
  await note.fill(draft);
  const beforeRefreshUrl = page.url();
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === detailPath && item.request().headers()["rsc"] === "1");
  await page.getByRole("button", { name: "重新读取状态" }).click();
  expect((await response).ok()).toBe(true);
  await expect(page).toHaveURL(beforeRefreshUrl);
  await expect(note).toHaveValue(draft);
  await expect(note).toBeEnabled();
  await expect(page.locator("#feedback")).toHaveCount(1);
  expect(await page.locator("#input").innerText()).toBe(inputBefore);
  if (resultBefore !== null) expect(await result.innerText()).toBe(resultBefore);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(note).toHaveValue(draft);
  }
  await note.fill(originalNote);
  await back.click();
  await expect(page).toHaveURL(/\/runs\?status=completed$/);
  // 返回后重开同一任务核对服务端，证明草稿与重新读取没有写入反馈。
  await page.goto(detailUrl);
  await page.getByRole("button", { name: /需要改进/ }).click();
  await expect(page.getByRole("textbox", { name: "结果反馈说明" })).toHaveValue(originalNote);
});
