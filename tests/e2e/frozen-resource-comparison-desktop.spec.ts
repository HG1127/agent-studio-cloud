import { expect, test } from "@playwright/test";
import { VersionExportFile } from "../../src/contracts/version";
import { VersionComparisonSelection, versionComparisonHref } from "../../src/features/versions/version-comparison-navigation";

test("桌面真实版本资源前后核对、独立展开、详情往返与反向对比全程只读", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [], errors: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/web-tools");
  const entry = page.getByRole("link", { name: "只读核对这个版本的流程" });
  await expect(entry, "需隔离环境中的真实已保存版本，不注入前端假版本").toBeVisible();
  const versionURL = new URL((await entry.getAttribute("href"))!, page.url());
  const match = versionURL.pathname.match(/^\/agents\/([0-9a-f-]{36})\/versions\/([0-9a-f-]{36})$/i);
  if (!match) throw new Error("实际冻结版本入口不符合当前路由");
  const agentId = match[1];
  await page.goto(`/agents/${agentId}#versions`);
  const comparison = page.locator(`a[href^="/agents/${agentId}/versions/compare?"]`).first();
  await expect(comparison, "需要当前助手的两份真实已保存版本；无数据不能跳过验收").toBeVisible();
  const comparisonURL = new URL((await comparison.getAttribute("href"))!, page.url());
  const pair = VersionComparisonSelection.parse(Object.fromEntries(comparisonURL.searchParams));
  async function exported(versionId: string) {
    const http = await page.request.get(`/api/agents/${agentId}/versions/${versionId}/export`);
    expect(http.ok()).toBe(true); return VersionExportFile.parse(await http.json());
  }
  const [before, after] = await Promise.all([exported(pair.from), exported(pair.to)]);
  await comparison.click();
  await expect(page.getByRole("heading", { name: "版本变化与资源核对", level: 1 })).toBeVisible();
  const left = page.getByRole("region", { name: `前一份 · 版本 ${before.version.number}`, exact: true });
  const right = page.getByRole("region", { name: `后一份 · 版本 ${after.version.number}`, exact: true });
  for (const side of [left, right]) {
    await expect(side).toContainText("模型选择"); await expect(side).toContainText("资料声明"); await expect(side).toContainText("工具目录");
    await expect(side.locator("details")).not.toHaveAttribute("open");
  }
  await expect(page.getByText("相同显示名称不能证明资源相同或执行一致。", { exact: false })).toBeVisible();
  await left.locator("summary").focus(); await page.keyboard.press("Enter");
  await expect(left.locator("details")).toHaveAttribute("open"); await expect(right.locator("details")).not.toHaveAttribute("open");
  await right.locator("summary").click(); await expect(right.locator("details")).toHaveAttribute("open");
  await page.getByRole("link", { name: `查看前一份冻结流程 · 版本 ${before.version.number}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`版本 ${before.version.number}`);
  const back = page.getByRole("link", { name: "返回版本对比" });
  await expect(back).toHaveAttribute("href", versionComparisonHref(agentId, pair));
  await back.focus(); await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new URL(versionComparisonHref(agentId, pair), page.url()).href);
  await expect(left.locator("details")).not.toHaveAttribute("open"); await expect(right.locator("details")).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "重新读取状态" }).click();
  await expect(page.getByRole("button", { name: "重新读取状态" })).toBeEnabled();
  await expect(left).toBeVisible(); await expect(right).toBeVisible();

  const reversed = { from: pair.to, to: pair.from };
  await page.goto(versionComparisonHref(agentId, reversed));
  await expect(page.getByRole("region", { name: `前一份 · 版本 ${after.version.number}`, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: `后一份 · 版本 ${before.version.number}`, exact: true })).toBeVisible();
  await page.getByRole("link", { name: `查看后一份冻结流程 · 版本 ${before.version.number}` }).click();
  await expect(page.getByRole("link", { name: "返回版本对比" })).toHaveAttribute("href", versionComparisonHref(agentId, reversed));
  await page.getByRole("link", { name: "返回版本对比" }).click();
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const text = await page.locator("main").innerText();
  for (const value of [agentId, pair.from, pair.to, before.manifest.resourceSelection.model.modelId, after.manifest.resourceSelection.model.modelId]) if (value) expect(text).not.toContain(value);
  expect(await exported(pair.from)).toEqual(before); expect(await exported(pair.to)).toEqual(after);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("资源对比只读边界", { body: JSON.stringify({ actualVersionsRead: 2, beforeVersion: before.version.number, afterVersion: after.version.number, preservedDirection: true, reversedDirection: true, exactReturn: true, writes: writes.length, pageErrors: errors.length, rawFieldProvenanceVerifiedByExport: false, currentResourceAvailabilityVerified: false }), contentType: "application/json" });
});
