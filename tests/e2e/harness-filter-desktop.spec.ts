import { expect, test } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";

test("桌面诊断保留三个分区范围并往返真实任务，全部操作只读", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.headers()["next-action"]) writes.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/harness");
  const choices = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link");
  await expect(choices.first()).toBeVisible();
  const completed = choices.filter({ has: page.getByText("已完成", { exact: true }) });
  expect(await completed.count(), "诊断范围验收需要真实已完成任务，不能用空态替代").toBeGreaterThan(0);
  const sourceHref = (await completed.first().getAttribute("href"))!;
  const runId = new URL(sourceHref, page.url()).searchParams.get("run")!;
  const response = await page.request.get(`/api/runs/${runId}/export`);
  expect(response.ok()).toBe(true);
  const report = RunReportFile.parse(await response.json());
  expect(report.run.id).toBe(runId);
  expect(report.steps.length).toBeGreaterThan(0);
  expect(report.trace.length).toBeGreaterThan(0);
  const event = report.trace.find((item) => item.nodeId && report.steps.some((step) => step.nodeId === item.nodeId));
  expect(event, "需从真实报告选择有关联步骤的已保存事件").toBeDefined();
  const step = report.steps.find((item) => item.nodeId === event!.nodeId)!;
  const params = new URLSearchParams({
    run: runId, runQuery: report.run.agentName.slice(0, 12).trim(), runAttention: "1",
    traceQuery: event!.title.slice(0, 12).trim(), traceNode: event!.nodeId!, traceAttention: "1",
    contextPage: "2", contextQuery: (step.nodeTitle || "来源").slice(0, 12).trim(),
  });
  const scopeHref = "/harness?" + params;
  await page.goto(scopeHref);
  await expect(page.getByRole("searchbox", { name: "按助手名称筛选最近运行" })).toHaveValue(params.get("runQuery")!);
  await expect(page.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toHaveValue(params.get("traceQuery")!);
  await expect(page.getByRole("combobox", { name: "查看关联步骤" })).toHaveValue(params.get("traceNode")!);
  await expect(page.getByRole("button", { name: /^需关注 \d+$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/所选任务被当前列表筛选隐藏/)).toBeVisible();
  const context = page.locator("#saved-context");
  await expect(context).toBeVisible();
  await expect(context.getByRole("searchbox")).toHaveValue(params.get("contextQuery")!);
  const lastPage = context.getByRole("link", { name: "返回最后一页" });
  await expect(lastPage).toBeVisible();
  const reset = new URL((await lastPage.getAttribute("href"))!, page.url());
  for (const key of ["run", "runQuery", "runAttention", "traceQuery", "traceNode", "traceAttention"]) expect(reset.searchParams.get(key)).toBe(params.get(key));
  expect(reset.hash).toBe("#saved-context");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/harness-scope-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page.getByRole("button", { name: "重新读取状态" })).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "查看关联步骤" })).toHaveValue(params.get("traceNode")!);
  await expect(page).toHaveURL(new URL(scopeHref, page.url()).href);
  const detail = page.getByRole("link", { name: "打开任务详情" });
  const detailHref = new URL((await detail.getAttribute("href"))!, page.url());
  expect(detailHref.searchParams.get("from")).toBe(scopeHref);
  await detail.click();
  await expect(page.getByRole("link", { name: "返回运行控制台" })).toHaveAttribute("href", scopeHref);
  const diagnostic = page.locator("main").getByRole("link", { name: "运行诊断", exact: true });
  await expect(diagnostic).toHaveAttribute("href", scopeHref);
  await diagnostic.click();
  await expect(page).toHaveURL(new URL(scopeHref, page.url()).href);
  await expect(page.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toHaveValue(params.get("traceQuery")!);
  await page.getByRole("link", { name: "打开任务详情" }).click();
  await page.getByRole("link", { name: "返回运行控制台" }).click();
  await expect(page).toHaveURL(new URL(scopeHref, page.url()).href);
  await page.getByRole("button", { name: "清除轨迹筛选" }).click();
  const cleared = new URLSearchParams(params);
  for (const key of ["traceQuery", "traceNode", "traceAttention"]) cleared.delete(key);
  await expect(page).toHaveURL(new URL("/harness?" + cleared + "#diagnostic-trace", page.url()).href);
  await expect(page.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toHaveValue("");
  await expect(context.getByRole("searchbox")).toHaveValue(params.get("contextQuery")!);
  await expect(page.getByRole("searchbox", { name: "按助手名称筛选最近运行" })).toHaveValue(params.get("runQuery")!);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.getByRole("region", { name: "执行轨迹" }).screenshot({ path: "qa/harness-trace-scope-desktop.png" });
  expect(writes).toEqual([]);
});

test("桌面重复诊断条件不扩大记录范围，清除只影响出错分区", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.headers()["next-action"]) writes.push(request.url()); });
  await page.goto("/harness");
  const first = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link").first();
  await expect(first).toBeVisible();
  const runId = new URL((await first.getAttribute("href"))!, page.url()).searchParams.get("run")!;
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const params = new URLSearchParams({ run: runId, runQuery: "诊断验收无匹配", contextPage: "2" });
    params.append("traceAttention", "1"); params.append("traceAttention", "1");
    await page.goto("/harness?" + params);
    await expect(page.getByRole("region", { name: "执行轨迹" }).getByRole("alert")).toContainText("轨迹筛选条件无效");
    await expect(page.getByRole("list", { name: "已保存的执行事件" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "打开任务详情" })).toBeVisible();
    await page.getByRole("button", { name: "清除轨迹筛选" }).click();
    params.delete("traceAttention");
    await expect(page).toHaveURL(new URL("/harness?" + params + "#diagnostic-trace", page.url()).href);
    await expect(page.getByRole("searchbox", { name: "按助手名称筛选最近运行" })).toHaveValue("诊断验收无匹配");
    await page.goto(`/harness?run=${runId}&run=${runId}`);
    await expect(page.getByRole("heading", { name: "找不到这次运行" })).toBeVisible();
    await expect(page.getByRole("region", { name: "本次任务的下一步" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
});
