import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { RunTaskReference } from "../../src/contracts/run-task";

const BODY = "隔离验收业务成果：北岸项目资料已整理，交付内容仅用于网页端下载核对。";
const LABEL = "专用验收业务正文";
const PRIVATE_INPUT = "仅属于隔离验收输入，不应进入业务成果下载";
const PRIVATE_UNSELECTED = "仅属于未选择的开发者记录，不应进入业务成果下载";
const STATE = "运行已完成；手动发起；完成状态不等于通过验收";

test("桌面真实已保存业务成果：手动下载文档与清单，不新增任何业务写操作", async ({ page }, testInfo) => {
  if (process.env.RUN_BUSINESS_EXPORT_E2E_ISOLATED !== "1") throw new Error("CI必须先证明专用隔离Neon与真实已保存成果归属，再显式允许只读验收；条件不足不skip或算通过");
  const reference = RunTaskReference.safeParse({ runId: process.env.RUN_BUSINESS_EXPORT_E2E_RUN_ID });
  if (!reference.success) throw new Error("需要CI提供专用隔离任务标识及受控真实保存成果；不以占位页面或注入成功响应代替");
  const runId = reference.data.runId;
  const writes: string[] = []; const errors: string[] = []; const downloads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto('/runs/' + runId);
  expect(response?.ok()).toBe(true);
  const result = page.locator("#result");
  const panel = page.getByRole("region", { name: "已保存业务成果导出" });
  await expect(result).toBeVisible();
  await expect(panel.getByRole("heading", { name: "导出已保存的业务展示内容" })).toBeVisible();
  await expect(panel.getByText(STATE, { exact: true })).toBeVisible();
  await expect(result.getByText(BODY, { exact: true })).toBeVisible();
  await expect(page.locator("#input")).toContainText(PRIVATE_INPUT);
  const technicalText = await result.locator("details pre").textContent();
  if (!technicalText) throw new Error("必须从本次真实页面的保存记录核对受控业务正文，不凭提示文字通过");
  expect(JSON.parse(technicalText)).toEqual({ report: BODY, private_unselected: PRIVATE_UNSELECTED });
  await expect(page.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "下载运行报告" })).toHaveAttribute("href", '/api/runs/' + runId + '/export');
  const savedResultText = await result.innerText();
  expect(downloads).toEqual([]); expect(writes).toEqual([]);
  const captured: { filename: string; bytes: number }[] = [];
  for (const [button, filename, format] of [["导出业务成果文档", "已保存业务成果.md", "md"], ["导出交付内容清单", "交付内容清单.csv", "csv"]] as const) {
    const pending = page.waitForEvent("download");
    await panel.getByRole("button", { name: button }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(filename); expect(await download.failure()).toBeNull();
    const savedPath = await download.path();
    if (!savedPath) throw new Error("浏览器未提供实际下载文件，不能只凭已发起提示计算成功");
    const bytes = await readFile(savedPath);
    const text = bytes.toString("utf8");
    expect(bytes.byteLength).toBeGreaterThan(Buffer.byteLength(BODY, "utf8"));
    expect(text).toContain(BODY); expect(text).toContain(LABEL); expect(text).toContain(STATE);
    for (const hidden of [PRIVATE_INPUT, PRIVATE_UNSELECTED, runId, "private_unselected", '"report"', '"input"', "agent-studio-cloud-run"]) expect(text).not.toContain(hidden);
    if (format === "md") {
      expect(text.startsWith("# 已保存业务成果\n")).toBe(true);
      expect(text).toContain("## " + LABEL); expect(text).toContain("不是完整的数据安全审查");
      expect(text.trimStart().startsWith("{")).toBe(false);
    } else {
      expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true);
      expect(text).toBe('\uFEFF"记录状态","交付内容","已保存内容"\r\n"' + STATE + '","' + LABEL + '","' + BODY + '"\r\n');
    }
    await expect(panel.getByRole("status")).toHaveText("已发起下载，请查看浏览器下载记录；本页不能确认文件是否已保存。");
    captured.push({ filename, bytes: bytes.byteLength });
  }
  expect(downloads).toEqual(["已保存业务成果.md", "交付内容清单.csv"]);
  expect((await result.innerText()).replace("已发起下载，请查看浏览器下载记录；本页不能确认文件是否已保存。", "").trim()).toBe(savedResultText.trim());
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(panel.getByRole("button", { name: "导出业务成果文档" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "导出交付内容清单" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("业务成果真实下载核对范围", { body: JSON.stringify({ actualSavedSeedRead: true, downloads: captured, businessWrites: writes.length, pageErrors: errors.length, viewportWidths: [1280, 1440], uiOnlyClaimsDownloadStarted: true, backendDeliveryOrAcceptanceClaimed: false }), contentType: "application/json" });
});
