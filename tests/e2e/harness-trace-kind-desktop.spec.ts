import { expect, test } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";

test("桌面实际已保存事件类别筛选、地址恢复和任务往返，全程只读", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url()); });
  await page.goto("/harness");
  const completed = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link").filter({ has: page.getByText("已完成", { exact: true }) });
  await expect(completed.first()).toBeVisible();
  const runId = new URL((await completed.first().getAttribute("href"))!, page.url()).searchParams.get("run")!;
  const response = await page.request.get(`/api/runs/${runId}/export`); expect(response.ok()).toBe(true);
  const report = RunReportFile.parse(await response.json()); expect(report.run.id).toBe(runId); expect(report.trace.length).toBeGreaterThan(0);
  const params = new URLSearchParams({ run: runId, runQuery: report.run.agentName.slice(0, 12).trim(), contextPage: "2", contextQuery: "资料" });
  const href = () => {
    const ordered = new URLSearchParams();
    for (const key of ["run", "runQuery", "traceKind", "contextPage", "contextQuery"]) { const value = params.get(key); if (value) ordered.set(key, value); }
    return "/harness?" + ordered;
  };
  await page.goto(href());
  const trace = page.getByRole("region", { name: "执行轨迹", exact: true });
  const rows = trace.locator('li[id^="diagnostic-event-"]');
  await expect(rows.first()).toBeVisible();
  const sequences = await rows.evaluateAll((items) => items.map((item) => Number(item.id.replace("diagnostic-event-", ""))));
  const actual = sequences.map((seq) => report.trace.find((event) => event.seq === seq));
  expect(actual.every((event) => event !== undefined)).toBe(true);
  const saved = actual.map((event) => event!);
  const kinds: Record<string, string[]> = { policy: ["harness.policy"], context: ["harness.context"], quality: ["quality.failed", "quality.passed", "quality.rework_requested"] };
  const recognized = Object.values(kinds).flat();
  const cases = [{ value: "policy", label: "运行策略" }, { value: "context", label: "上下文边界" }, { value: "quality", label: "质量检查" }, { value: "other", label: "其他与未知" }, { value: "all", label: "全部类型" }];
  for (const item of cases) {
    await trace.getByRole("radio", { name: item.label, exact: true }).check();
    const expected = saved.filter((event) => item.value === "all" || item.value === "other" ? item.value === "all" || !recognized.includes(event.kind) : kinds[item.value].includes(event.kind));
    await expect(rows).toHaveCount(expected.length);
    await trace.getByRole("button", { name: "应用轨迹筛选", exact: true }).click();
    if (item.value === "all") params.delete("traceKind"); else params.set("traceKind", item.value);
    await expect(page).toHaveURL(new URL(href() + "#diagnostic-trace", page.url()).href);
    await expect(trace.getByRole("radio", { name: item.label, exact: true })).toBeChecked();
    const detail = page.getByRole("link", { name: "打开任务详情", exact: true });
    expect(new URL((await detail.getAttribute("href"))!, page.url()).searchParams.get("from")).toBe(href());
  }
  const first = rows.first(); await first.locator("summary").click();
  await first.getByRole("button", { name: "返回这条事件", exact: true }).click();
  await expect(first).toBeFocused(); await expect(first.locator("details")).not.toHaveAttribute("open", "");
  await trace.getByRole("radio", { name: "其他与未知", exact: true }).check();
  await trace.getByRole("button", { name: "应用轨迹筛选", exact: true }).click(); params.set("traceKind", "other");
  await page.getByRole("link", { name: "打开任务详情", exact: true }).click();
  await expect(page.getByRole("link", { name: "返回运行控制台", exact: true })).toHaveAttribute("href", href());
  await page.getByRole("link", { name: "返回运行控制台", exact: true }).click();
  await expect(trace.getByRole("radio", { name: "其他与未知", exact: true })).toBeChecked();
  const invalid = new URLSearchParams(params); invalid.append("traceKind", "other"); await page.goto("/harness?" + invalid);
  await expect(trace.getByRole("alert")).toContainText("轨迹筛选条件无效"); await expect(rows).toHaveCount(0);
  await trace.getByRole("button", { name: "清除轨迹筛选", exact: true }).click(); params.delete("traceKind");
  await expect(page).toHaveURL(new URL(href() + "#diagnostic-trace", page.url()).href);
  await expect(trace.getByRole("radio", { name: "全部类型", exact: true })).toBeChecked(); await expect(rows).toHaveCount(saved.length);
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("实际最近轨迹类别核对", { body: JSON.stringify({ runId, sequences, writes, errors, completeHistoryProven: false, judgmentDataAvailable: false }, null, 2), contentType: "application/json" });
});
