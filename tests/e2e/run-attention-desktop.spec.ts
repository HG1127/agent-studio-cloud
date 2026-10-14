import { expect, test } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";

test("桌面待处理分类独立翻页、真实范围及详情返回全程只读", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/runs");
  await page.getByRole("link", { name: "任务提醒", exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/attention$/);
  await expect(page.getByRole("heading", { name: "待处理任务", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("待处理任务");
  await expect(page.getByRole("navigation", { name: "待处理分类" })).toBeVisible();
  const failed = page.getByRole("region", { name: "失败待核对", exact: true });
  const first = failed.locator('ul li a[href^="/runs/"]').first();
  await expect(first, "待处理网页验收需要真实失败记录，不使用模拟列表").toBeVisible();
  const href = await first.getAttribute("href");
  const runPath = new URL(href!, page.url()).pathname;
  const reportResponse = await page.request.get(`/api${runPath}/export`);
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.status).toBe("failed");
  const scope = new URLSearchParams({ source: report.run.sourceType, agent: report.run.agentId, approvalPage: "987", eventPage: "987" });
  const scopedHref = `/runs/attention?${scope}`;
  await page.goto(scopedHref);
  await expect(page.getByLabel("助手", { exact: true })).toHaveValue(report.run.agentId);
  await expect(page.getByLabel("发起方式")).toHaveValue(report.run.sourceType);
  const approval = page.getByRole("region", { name: "等待确认或恢复", exact: true });
  await expect(approval.getByRole("heading", { name: "当前页没有记录" })).toBeVisible();
  await expect(approval.getByRole("link", { name: "回到这一类的第一页" })).toHaveAttribute("href", `/runs/attention?source=${report.run.sourceType}&agent=${report.run.agentId}&eventPage=987#attention-approval`);
  const record = failed.locator(`a[href^="${runPath}?"]`);
  await expect(record).toHaveCount(1);
  expect(new URL((await record.getAttribute("href"))!, page.url()).searchParams.get("from")).toBe(scopedHref);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const refreshResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/runs/attention" && response.request().headers()["rsc"] === "1");
  await page.getByRole("button", { name: "重新读取状态", exact: true }).click();
  expect((await refreshResponse).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "重新读取状态", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "重新读取状态", exact: true })).toHaveAttribute("aria-busy", "false");
  await expect(page).toHaveURL(new URL(scopedHref, page.url()).href);
  await expect(record).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: "qa/run-attention-desktop.png" });
    await failed.scrollIntoViewIfNeeded();
    await expect(page.getByRole("navigation", { name: "主导航", exact: true })).toBeInViewport({ ratio: 0.5 });
    await expect(page.getByRole("banner")).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: "qa/run-attention-failed-desktop.png" });
  }
  await record.click();
  await expect(page.getByRole("heading", { level: 1, name: report.run.agentName })).toBeVisible();
  const back = page.getByRole("link", { name: "返回待处理任务", exact: true });
  await expect(back).toHaveAttribute("href", scopedHref);
  await back.click();
  await expect(page).toHaveURL(new URL(scopedHref, page.url()).href);
  await approval.getByRole("link", { name: "回到这一类的第一页" }).click();
  await expect(page).toHaveURL(new RegExp(`eventPage=987#attention-approval$`));
  await expect(page.getByRole("navigation", { name: "等待继续翻页" })).toContainText("第 987 页");
  await page.getByLabel("发起方式").selectOption(report.run.sourceType);
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByLabel("助手", { exact: true })).toHaveValue(report.run.agentId);
  expect(new URL(page.url()).searchParams.has("eventPage")).toBe(false);
  expect(new URL(page.url()).searchParams.has("approvalPage")).toBe(false);
  expect(writes).toEqual([]);
});

test("桌面无效待处理范围不扩大查询并可显式清除", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/runs/attention?agent=not-an-agent");
  await expect(page.locator("main").getByRole("alert")).toContainText("尚未读取任务");
  await expect(page.getByRole("region", { name: "失败待核对", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "清除无效筛选" }).click();
  await expect(page).toHaveURL(/\/runs\/attention$/);
  await expect(page.getByRole("heading", { name: "待处理任务", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
