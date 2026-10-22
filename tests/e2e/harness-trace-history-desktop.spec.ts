import { expect, test } from "@playwright/test";
import { MAX_VISIBLE_TRACE_EVENTS, RunReportFile, RunView } from "../../src/contracts/run";
import { HarnessNavigation, harnessConsoleHref } from "../../src/features/harness/harness-navigation";
import { TRACE_HISTORY_PAGE_SIZE } from "../../src/features/harness/trace-history-view";
import { MAX_PAGE_NUMBER } from "../../src/lib/search-params";

test("桌面真实较早轨迹、有限分页、筛选和任务返回链，全程只读", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const run = RunView.shape.id.safeParse(process.env.HARNESS_HISTORY_E2E_RUN_ID);
  if (!run.success || process.env.HARNESS_HISTORY_E2E_ISOLATED !== "1") {
    throw new Error("本规格须由 CI 先外部核实隔离环境，再提供 HARNESS_HISTORY_E2E_RUN_ID 与隔离旗标；旗标本身不是隔离证明，不允许创建任务或注入成功记录。");
  }
  const runId = run.data.toLowerCase();
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.request.get(`/api/runs/${runId}/export`);
  expect(response.ok()).toBe(true);
  const report = RunReportFile.parse(await response.json());
  expect(report.run.id.toLowerCase()).toBe(runId);
  if (!["completed", "failed", "cancelled"].includes(report.run.status) || report.trace.length <= MAX_VISIBLE_TRACE_EVENTS) {
    throw new Error("隔离环境须提供一条已结束且实际保存超过五百条可解析轨迹的任务；不能把占位或未准备数据计作正向通过。");
  }
  const keyword = "历史核对";
  const matched = report.trace.filter((event) => `${event.title} ${event.detail ?? ""}`.includes(keyword));
  if (!matched.length) throw new Error("专用隔离任务须已保存可核对的‘历史核对’事件片段，规格不会写入或补造记录。");
  const overflowPage = Math.ceil(matched.length / TRACE_HISTORY_PAGE_SIZE) + 1;
  if (!Number.isSafeInteger(overflowPage) || overflowPage > MAX_PAGE_NUMBER) {
    throw new Error("专用隔离任务的关键词匹配范围过大，无法在支持页码内构造真实溢出反例；须另选已保存的隔离任务，不会放宽断言或补造记录。");
  }
  const base = HarnessNavigation.parse({ runId, context: { page: 2, query: "资料" } });
  const history = HarnessNavigation.parse({ ...base, trace: { ...base.trace, range: "history", page: 1 } });
  await page.goto(harnessConsoleHref(base));
  const trace = page.getByRole("region", { name: "执行轨迹", exact: true });
  const rows = trace.locator('li[id^="diagnostic-event-"]');
  const sequences = async () => rows.evaluateAll((items) => items.map((item) => Number(item.id.replace("diagnostic-event-", ""))));
  await expect(rows.first()).toBeVisible();
  const recentSequences = await sequences();
  expect(recentSequences.length).toBeLessThanOrEqual(MAX_VISIBLE_TRACE_EVENTS);
  expect(recentSequences).not.toContain(report.trace[0].seq);
  expect(recentSequences.every((seq) => report.trace.some((event) => event.seq === seq))).toBe(true);
  await page.getByRole("link", { name: "核对较早轨迹", exact: true }).click();
  await expect(page).toHaveURL(new URL(harnessConsoleHref(history, "diagnostic-trace"), page.url()).href);
  await expect(rows).toHaveCount(TRACE_HISTORY_PAGE_SIZE);
  expect(await sequences()).toEqual(report.trace.slice(0, TRACE_HISTORY_PAGE_SIZE).map((event) => event.seq));
  await expect(trace).toContainText("不保证所有原始记录都已纳入");
  await expect(page.getByText(/证据概览与上方最近需关注事件仍来自最近事件/)).toBeVisible();
  await page.getByRole("link", { name: "历史下一页", exact: true }).click();
  const second = HarnessNavigation.parse({ ...history, trace: { ...history.trace, page: 2 } });
  await expect(page).toHaveURL(new URL(harnessConsoleHref(second, "diagnostic-trace"), page.url()).href);
  expect(await sequences()).toEqual(report.trace.slice(TRACE_HISTORY_PAGE_SIZE, TRACE_HISTORY_PAGE_SIZE * 2).map((event) => event.seq));
  await page.reload();
  await expect(rows).toHaveCount(TRACE_HISTORY_PAGE_SIZE);
  await page.getByRole("link", { name: "打开任务详情", exact: true }).click();
  await expect(page.getByRole("link", { name: "返回运行控制台", exact: true })).toHaveAttribute("href", harnessConsoleHref(second));
  await page.getByRole("link", { name: "返回运行控制台", exact: true }).click();
  await expect(rows).toHaveCount(TRACE_HISTORY_PAGE_SIZE);
  expect(await sequences()).toEqual(report.trace.slice(TRACE_HISTORY_PAGE_SIZE, TRACE_HISTORY_PAGE_SIZE * 2).map((event) => event.seq));
  await trace.getByRole("searchbox", { name: "搜索已读取的轨迹" }).fill(keyword);
  await expect(rows).toHaveCount(TRACE_HISTORY_PAGE_SIZE);
  await expect(trace).toContainText("当前填写尚未应用");
  await trace.getByRole("button", { name: "应用轨迹筛选", exact: true }).click();
  const filtered = HarnessNavigation.parse({ ...history, trace: { ...history.trace, query: keyword, page: 1 } });
  await expect(page).toHaveURL(new URL(harnessConsoleHref(filtered, "diagnostic-trace"), page.url()).href);
  await expect(rows).toHaveCount(Math.min(TRACE_HISTORY_PAGE_SIZE, matched.length));
  expect(await sequences()).toEqual(matched.slice(0, TRACE_HISTORY_PAGE_SIZE).map((event) => event.seq));
  const overflow = HarnessNavigation.parse({ ...filtered, trace: { ...filtered.trace, page: overflowPage } });
  await page.goto(harnessConsoleHref(overflow));
  await expect(rows).toHaveCount(0);
  await expect(trace).toContainText("这个历史页没有可读事件，不表示整个范围为空");
  await expect(trace.getByRole("searchbox", { name: "搜索已读取的轨迹" })).toBeVisible();
  await page.getByRole("link", { name: "返回历史最后一页", exact: true }).click();
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeLessThanOrEqual(TRACE_HISTORY_PAGE_SIZE);
  const invalid = new URL(harnessConsoleHref(history), page.url());
  invalid.searchParams.append("traceRange", "history");
  await page.goto(invalid.href);
  await expect(trace.getByRole("alert")).toContainText("轨迹筛选条件无效");
  await expect(rows).toHaveCount(0);
  await trace.getByRole("button", { name: "清除轨迹筛选", exact: true }).click();
  await expect(page).toHaveURL(new URL(harnessConsoleHref(base, "diagnostic-trace"), page.url()).href);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach("真实历史只读路径证据", { body: JSON.stringify({ runId, recentSequences, parsedHistoricalCount: report.trace.length,
    pageSize: TRACE_HISTORY_PAGE_SIZE, writes, errors, originalRecordCompletenessProven: false, externalIsolationProofRequired: true,
    isolationVerifiedByThisSpec: false }, null, 2), contentType: "application/json" });
});
