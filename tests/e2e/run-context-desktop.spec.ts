import { expect, test } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";
import { contextResultPreview } from "../../src/features/harness/run-context-preview";

test("桌面真实上游结果快照可筛选、核对来源、处理越界和下载，全程只读", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/runs?status=completed");
  const first = page.locator('main ul li a[href^="/runs/"]').first();
  await expect(first, "快照桌面验收需要真实已完成任务").toBeVisible();
  const detail = new URL((await first.getAttribute("href"))!, page.url());
  const reportResponse = await page.request.get("/api" + detail.pathname + "/export");
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.status).toBe("completed");
  expect(report.context).not.toBeNull();
  const outputs = report.context!.outputs;
  expect(outputs && typeof outputs === "object" && !Array.isArray(outputs), "需要实际保存的上游结果清单").toBe(true);
  const entries = Object.entries(outputs as Record<string, unknown>);
  const index = entries.findIndex(([nodeId, value]) => typeof value === "string"
    && report.steps.some((step) => step.nodeId === nodeId && step.nodeType === "ai"));
  expect(index, "需要能与真实步骤精确关联的文字快照，不插入模拟记录").toBeGreaterThanOrEqual(0);
  const [nodeId, value] = entries[index];
  const step = report.steps.find((item) => item.nodeId === nodeId)!;
  expect(step.output !== null && typeof step.output === "object" && !Array.isArray(step.output)).toBe(true);
  expect((step.output as Record<string, unknown>).output).toBe(value);
  const preview = contextResultPreview(value, step.nodeType);
  expect(preview.readable).toBe(true);
  const expectedText = preview.readable ? preview.value as string : "";
  expect(typeof expectedText).toBe("string");
  const title = step.nodeTitle?.trim() || "未命名步骤";
  const nodeSelector = await page.evaluate((id) => CSS.escape(id), nodeId);
  const scope = "/harness?run=" + report.run.id;
  const sourcePage = Math.floor(index / 10) + 1;
  await page.goto(scope + (sourcePage > 1 ? "&contextPage=" + sourcePage : "") + "#saved-context");
  const section = page.getByRole("region", { name: "已保存的上游结果快照" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("当前快照共有 " + entries.length + " 项来源结果");
  await expect(section).toContainText("没有独立保存时间");
  const source = section.locator('li[data-context-node="' + nodeSelector + '"]');
  await expect(source.getByRole("heading", { name: title, exact: true })).toBeVisible();
  const record = source.locator("details");
  const summary = record.locator("summary");
  await expect(summary).toBeVisible();
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(record).toHaveAttribute("open");
  await expect(source.getByRole("group", { name: "上游结果内容预览" })).toContainText(expectedText);
  await expect(section.getByRole("button", { name: /复制/ })).toHaveCount(0);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(source.getByRole("group", { name: "上游结果内容预览" })).toContainText(expectedText);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await section.evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect(page.getByRole("banner")).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: "qa/run-context-desktop.png" });
  }
  const targetId = await page.locator('details[data-step-node="' + nodeSelector + '"]').evaluate((element) => element.closest("li")!.id);
  await expect(source.getByRole("link", { name: "定位到关联步骤" })).toHaveAttribute("href", "#" + targetId);
  await source.getByRole("link", { name: "定位到关联步骤" }).click();
  expect(new URL(page.url()).hash).toBe("#" + targetId);
  await expect(page.locator('[id="' + targetId + '"]')).toBeFocused();
  await expect(page.getByRole("navigation", { name: "选择诊断任务" }).locator('[aria-current="page"]')).toHaveAttribute("href", scope);

  await section.getByRole("searchbox", { name: "按来源步骤名称筛选快照" }).fill(title);
  await section.getByRole("button", { name: "应用快照筛选" }).click();
  await expect(page).toHaveURL(new RegExp("contextQuery="));
  expect(new URL(page.url()).searchParams.get("run")).toBe(report.run.id);
  expect(new URL(page.url()).searchParams.get("contextPage")).toBeNull();
  expect(new URL(page.url()).searchParams.get("contextQuery")).toBe(title);
  await expect(section.locator('li[data-context-node="' + nodeSelector + '"]')).toBeVisible();
  await section.getByRole("searchbox").fill("尚未应用的查询");
  await section.getByRole("link", { name: "清除快照筛选" }).click();
  await expect(section.getByRole("searchbox")).toHaveValue("");
  expect(new URL(page.url()).searchParams.get("run")).toBe(report.run.id);

  await page.goto(scope + "&contextPage=10000&contextQuery=" + encodeURIComponent(title) + "#saved-context");
  await expect(section.getByRole("status")).toContainText("不表示整个范围为空");
  const last = section.getByRole("link", { name: "返回最后一页" });
  const lastUrl = new URL((await last.getAttribute("href"))!, page.url());
  expect(lastUrl.searchParams.get("run")).toBe(report.run.id);
  expect(lastUrl.searchParams.get("contextQuery")).toBe(title);
  await last.click();
  await expect(section.getByRole("list", { name: "快照来源结果" })).toBeVisible();
  await page.goto(scope + "&contextPage=bad#saved-context");
  await expect(section.getByRole("alert")).toContainText("快照筛选条件无效");
  await expect(section.getByRole("list", { name: "快照来源结果" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "已保存的步骤" })).toBeVisible();
  await section.getByRole("link", { name: "清除快照筛选" }).click();
  const response = await page.request.get(await section.getByRole("link", { name: "下载含快照的运行报告" }).getAttribute("href") as string);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-disposition"]).toContain("attachment");
  const after = RunReportFile.parse(await response.json());
  expect(after.run.id).toBe(report.run.id);
  expect(after.context).toEqual(report.context);
  expect(writes).toEqual([]);
});
