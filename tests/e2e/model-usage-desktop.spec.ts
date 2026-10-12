import { expect, test } from "@playwright/test";
import { RunModelUsageResult } from "../../src/contracts/model-usage";
import { RunModelUsageChainResult } from "../../src/contracts/model-usage-chain";

test("桌面真实任务用量分区读取、键盘核对和重读，不写业务记录", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await page.goto("/runs?status=completed");
  const first = page.locator('main ul li a[href^="/runs/"]').first();
  await expect(first, "需要隔离环境中的实际已完成任务，不注入前端假统计").toBeVisible();
  const href = (await first.getAttribute("href"))!;
  const runPath = new URL(href, page.url()).pathname, runId = runPath.split("/").at(-1)!;
  const ownRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api" + runPath + "/usage" && response.request().method() === "GET");
  const chainRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api" + runPath + "/usage/chain" && response.request().method() === "GET");
  await page.goto(href + "#model-usage");
  const [ownResponse, chainResponse] = await Promise.all([ownRead, chainRead]);
  expect(ownResponse.ok()).toBe(true); expect(chainResponse.ok()).toBe(true);
  const own = RunModelUsageResult.parse(await ownResponse.json()), chain = RunModelUsageChainResult.parse(await chainResponse.json());
  expect(own.ok).toBe(true); expect(chain.ok).toBe(true);
  if (!own.ok || !chain.ok) throw new Error("真实模型用量响应未通过核对");
  expect(own.summary.runId).toBe(runId); expect(chain.summary.requestedRunId).toBe(runId);
  const current = page.getByRole("article", { name: "当前任务自身" }), chainView = page.getByRole("article", { name: "已纳入的协作链" });
  const quantity = (value: number | null) => value === null ? "未知" : value.toLocaleString("zh-CN");
  for (const [panel, summary] of [[current, own.summary], [chainView, chain.summary]] as const) {
    for (const [label, value] of [["已登记调用", summary.calls.total], ["已知输入用量", summary.usage.knownInputTokens],
      ["已知输出用量", summary.usage.knownOutputTokens], ["完整报告的已知合计", summary.usage.knownCallTotalTokens]] as const) {
      await expect(panel.locator(":scope > dl dt").filter({ hasText: new RegExp("^" + label + "$") }).locator("..").locator("dd")).toHaveText(quantity(value));
    }
  }
  await expect(page.locator("#model-usage")).toContainText("不能把它们相加");
  const details = chainView.locator(":scope > details"), summaryControl = details.locator("summary");
  await summaryControl.focus(); await expect(summaryControl).toBeFocused(); await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open");
  const rows = details.locator("ol > li");
  await expect(rows).toHaveCount(chain.summary.runs.length);
  for (let index = 0; index < chain.summary.runs.length; index++) {
    const record = chain.summary.runs[index], row = rows.nth(index);
    await expect(row).toContainText(record.summary.runId === runId ? "当前任务" : record.summary.runId === chain.summary.anchorRunId
      ? chain.summary.graph.rootKnown ? "起始任务" : "本次统计起点" : "关联任务 " + (index + 1));
    await expect(row).not.toContainText(record.summary.runId);
    if (record.summary.runId !== runId) await expect(row.getByRole("link")).toHaveAttribute("href", "/runs/" + record.summary.runId + "#model-usage");
  }
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await summaryControl.focus(); await page.keyboard.press("Enter"); await expect(details).not.toHaveAttribute("open");
  const refreshedOwn = page.waitForResponse((response) => new URL(response.url()).pathname === "/api" + runPath + "/usage" && response.request().method() === "GET");
  const refreshedChain = page.waitForResponse((response) => new URL(response.url()).pathname === "/api" + runPath + "/usage/chain" && response.request().method() === "GET");
  await page.getByRole("button", { name: "重新读取用量" }).click();
  expect((await refreshedOwn).ok()).toBe(true); expect((await refreshedChain).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "重新读取用量" })).toBeEnabled();
  expect(writes).toEqual([]);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/model-usage-desktop.png", fullPage: true });
});
