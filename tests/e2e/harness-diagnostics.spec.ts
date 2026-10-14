import { expect, test } from "@playwright/test";

test("运行诊断展示真实任务并能往返任务详情", async ({ page }) => {
  await page.goto("/harness");
  await expect(page.getByRole("heading", { name: "运行控制台" })).toBeVisible();
  await expect(page.getByText(/轨迹事件不能代替完整的规则判决/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "尚未接入的运行控制" })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/harness-diagnostics-desktop.png", fullPage: true });

  const runLinks = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link");
  if (await runLinks.count()) {
    const firstHref = await runLinks.first().getAttribute("href");
    expect(firstHref).toMatch(/^\/harness\?run=[0-9a-f-]{36}$/i);
    await page.getByRole("searchbox", { name: "按助手名称筛选最近运行" }).fill("不存在的助手名称 999999");
    await expect(page.getByText("最近记录中没有匹配的任务。")).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(runLinks.first()).toHaveAttribute("href", firstHref!);
    const attentionFilter = page.getByRole("button", { name: /^失败或等待 \d+$/ });
    await attentionFilter.click();
    await expect(attentionFilter).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("group", { name: "筛选最近运行" }).getByRole("button", { name: /^全部 \d+$/ }).click();
    await runLinks.first().click();
    await expect(page).toHaveURL(/\/harness\?run=[0-9a-f-]{36}$/i);
    await expect(page.getByRole("heading", { name: "已保存的步骤" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "执行轨迹" })).toBeVisible();
    const report = page.getByRole("link", { name: "下载运行报告" });
    await expect(report).toHaveAttribute("href", /^\/api\/runs\/[0-9a-f-]{36}\/export$/i);
    const [download] = await Promise.all([page.waitForEvent("download"), report.click()]);
    expect(await download.failure()).toBeNull();
    const traceSearch = page.getByRole("searchbox", { name: "搜索已读取的轨迹" });
    if (await traceSearch.count()) {
      await traceSearch.fill("不存在的轨迹 999999");
      await expect(page.getByText("当前已读取的轨迹中没有符合关键词与筛选条件的事件。")).toBeVisible();
      await page.getByRole("button", { name: "清除轨迹筛选" }).click();
      const eventInformation = page.getByRole("region", { name: "执行轨迹" }).locator("details").first();
      await eventInformation.locator("summary").click();
      await expect(eventInformation.getByText(/已保存的记录顺序：第 \d+ 条/)).toBeVisible();
      if (process.env.CAPTURE_UI_AUDIT === "1") await eventInformation.screenshot({ path: "qa/harness-event-information-desktop.png" });
    }
    const stepRecords = page.getByRole("region", { name: "已保存的步骤" }).locator("details");
    if (await stepRecords.count()) {
      const record = stepRecords.first();
      if ((await record.getAttribute("open")) === null) await record.locator("summary").click();
      await expect(record.getByText("尝试次数", { exact: true })).toBeVisible();
      await expect(record.getByText("本条开始时间", { exact: true })).toBeVisible();
      if (process.env.CAPTURE_UI_AUDIT === "1") await record.screenshot({ path: "qa/harness-step-evidence-desktop.png" });
    }
    const stepFilter = page.getByRole("combobox", { name: "查看关联步骤" });
    if (await stepFilter.count()) {
      await stepFilter.selectOption({ index: 1 });
      await expect(stepFilter).not.toHaveValue("");
      await expect(page.getByRole("group", { name: "筛选执行轨迹" }).getByRole("button", { name: /^全部 \d+$/ })).toBeVisible();
      await stepFilter.selectOption("");
    }
    await page.getByRole("button", { name: /需关注 \d+/ }).click();
    await expect(page.getByRole("button", { name: /需关注 \d+/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: "打开任务详情" }).click();
    await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}\?from=/i);
    await page.locator("main").getByRole("link", { name: "运行诊断" }).click();
    await expect(page).toHaveURL(/\/harness\?run=[0-9a-f-]{36}$/i);
    await expect(page.getByRole("heading", { name: "执行轨迹" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    if (await traceSearch.count()) {
      const eventInformation = page.getByRole("region", { name: "执行轨迹" }).locator("details").first();
      await eventInformation.locator("summary").click();
      await expect(eventInformation.getByText(/已保存的记录顺序：第 \d+ 条/)).toBeVisible();
      if (process.env.CAPTURE_UI_AUDIT === "1") await eventInformation.screenshot({ path: "qa/harness-event-information-mobile.png" });
    }
    if (await stepRecords.count()) {
      const record = stepRecords.first();
      if ((await record.getAttribute("open")) === null) await record.locator("summary").click();
      await expect(record.getByText("本条结束时间", { exact: true })).toBeVisible();
      if (process.env.CAPTURE_UI_AUDIT === "1") await record.screenshot({ path: "qa/harness-step-evidence-mobile.png" });
    }
    if (await stepFilter.count()) {
      await stepFilter.selectOption({ index: 1 });
      await expect(stepFilter).not.toHaveValue("");
      if (process.env.CAPTURE_UI_AUDIT === "1") await page.getByRole("region", { name: "执行轨迹" }).screenshot({ path: "qa/harness-evidence-filter-mobile.png" });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  } else {
    await expect(page.getByText("还没有运行记录")).toBeVisible();
  }
});

test("不存在的运行显示诚实空状态，手机端无水平溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/harness?run=00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "找不到这次运行" })).toBeVisible();
  await expect(page.getByRole("link", { name: "前往运行记录" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/harness-diagnostics-mobile.png", fullPage: true });
});
