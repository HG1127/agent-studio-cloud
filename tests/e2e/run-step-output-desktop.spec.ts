import { expect, test } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";
import { redactSensitiveData, redactSensitiveText } from "../../src/server/domain/security/redact-sensitive";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("桌面真实步骤产出在任务详情与诊断中可键盘展开、脱敏复制且全程只读", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/runs?status=completed");
  const first = page.locator('main ul li a[href^="/runs/"]').first();
  await expect(first, "步骤产出网页验收需要实际已完成任务").toBeVisible();
  const href = (await first.getAttribute("href"))!;
  const runPath = new URL(href, page.url()).pathname;
  const reportResponse = await page.request.get("/api" + runPath + "/export");
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.status).toBe("completed");
  const saved = report.steps.find((step) =>
    step.status === "succeeded" && step.output !== null && typeof step.output === "object"
    && !Array.isArray(step.output) && typeof (step.output as Record<string, unknown>).output === "string");
  expect(saved, "需要真实已保存的文字步骤产出，不插入模拟记录").toBeTruthy();
  const safeOutput = redactSensitiveData(saved!.output) as Record<string, unknown>;
  const expectedJson = JSON.stringify(safeOutput, null, 2);
  const nodeSelector = await page.evaluate((value) => CSS.escape(value), saved!.nodeId);
  const runId = runPath.split("/").at(-1)!;
  for (const [route, screenshot] of [
    [href, "qa/run-step-output-desktop.png"],
    ["/harness?run=" + runId, "qa/harness-step-output-desktop.png"],
  ]) {
    await page.goto(route);
    const record = page.locator('details[data-step-node="' + nodeSelector + '"]');
    await expect(record).toHaveCount(1);
    await expect(record).not.toHaveAttribute("open");
    const summary = record.locator("summary").first();
    await expect(summary).toBeVisible();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(record).toHaveAttribute("open");
    await expect(record.getByRole("group", { name: "步骤产出预览" })).toContainText(redactSensitiveText(safeOutput.output as string));
    await expect(record).toContainText("不是本次最终交付");
    await expect(record).toContainText("本条开始时间");
    const raw = record.locator("details").first();
    await expect(raw).not.toHaveAttribute("open");
    await raw.locator("summary").click();
    await expect(raw.locator("pre")).toHaveText(expectedJson);
    await record.getByRole("button", { name: "复制脱敏步骤数据" }).click();
    await expect(record.getByRole("status")).toHaveText("已复制");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    // Windows 系统剪贴板将换行规范化为 CRLF，仍须核对完整脱敏 JSON。
    expect(clipboard.replace(/\r\n/g, "\n")).toBe(expectedJson);
    expect(JSON.parse(clipboard)).toEqual(safeOutput);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(raw.locator("pre")).toHaveText(expectedJson);
    }
    if (process.env.CAPTURE_UI_AUDIT === "1") {
      await record.evaluate((element) => {
        element.scrollIntoView({ block: "start" });
        const navigation = document.querySelector('nav[aria-label="运行详情区块"]');
        const offset = element.getBoundingClientRect().top - ((navigation?.getBoundingClientRect().bottom ?? 58) + 16);
        if (offset < 0) window.scrollBy(0, offset);
      });
      await expect(page.getByRole("banner")).toBeInViewport({ ratio: 1 });
      await expect(summary).toBeInViewport({ ratio: 1 });
      const banner = await page.getByRole("banner").boundingBox();
      const navigation = page.getByRole("navigation", { name: "运行详情区块" });
      const navigationBox = await navigation.count() ? await navigation.boundingBox() : null;
      const summaryBox = await summary.boundingBox();
      expect(summaryBox!.y).toBeGreaterThanOrEqual(Math.max(banner!.y + banner!.height, navigationBox ? navigationBox.y + navigationBox.height : 0));
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: screenshot });
    }
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(record).not.toHaveAttribute("open");
  }
  expect(writes).toEqual([]);
});
