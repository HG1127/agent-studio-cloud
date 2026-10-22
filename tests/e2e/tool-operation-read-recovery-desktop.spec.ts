import { expect, test } from "@playwright/test";
import { ToolOperationGetResult, ToolOperationListResult, ToolOperationResolveInput } from "../../src/contracts/tool-operation";

test("桌面原请求读取慢读恢复：只读真实记录，故障注入不写业务结论", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  const blockedSubmissions: ToolOperationResolveInput[] = [];
  const unexpectedWrites: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const listWait = page.waitForResponse((value) => new URL(value.url()).pathname === "/api/tool-operations" && value.request().method() === "GET");
  await page.goto("/tool-operations?status=blocked");
  const listHttp = await listWait; expect(listHttp.ok()).toBe(true);
  const list = ToolOperationListResult.parse(await listHttp.json());
  if (!list.ok) throw new Error("隔离验收环境的实际工具核对列表无法读取");
  const selected = list.items.findIndex((item) => item.status === "blocked" && item.resolutionCount < 50 && Date.parse(item.retryDeadline) > Date.now());
  if (selected < 0) throw new Error("需要隔离环境中的真实、未过期、历史未达上限的待核对工具记录；不跳过或注入前端假记录");
  const summary = list.items[selected];
  const path = `/api/tool-operations/${summary.id}`;
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !(new URL(request.url()).pathname === path && request.method() === "POST")) unexpectedWrites.push(new URL(request.url()).pathname);
  });
  const detailWait = page.waitForResponse((value) => new URL(value.url()).pathname === path && value.request().method() === "GET");
  await page.getByRole("region", { name: "业务核对记录列表" }).getByRole("button", { name: /查看.*的核对记录/ }).nth(selected).click();
  const detailHttp = await detailWait; expect(detailHttp.ok()).toBe(true);
  const detail = ToolOperationGetResult.parse(await detailHttp.json());
  if (!detail.ok || detail.operation.id !== summary.id || detail.operation.sourceRunId !== summary.sourceRunId) throw new Error("真实详情归属不匹配");

  let holdHistory = false;
  let heldReads = 0;
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  await page.route("**/api/tool-operations/**", async (route) => {
    const request = route.request();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      if (new URL(request.url()).pathname === path && request.method() === "POST") {
        blockedSubmissions.push(ToolOperationResolveInput.parse(request.postDataJSON()));
      } else unexpectedWrites.push(new URL(request.url()).pathname);
      await route.abort("failed"); return;
    }
    if (holdHistory && new URL(request.url()).pathname === path) {
      heldReads += 1;
      await historyGate;
      await route.abort("aborted").catch(() => undefined); return;
    }
    await route.continue();
  });
  const form = page.getByRole("region", { name: "填写核对结论" });
  try {
  await form.getByLabel("业务系统查询结果").selectOption("retry");
  await form.getByLabel("核对依据").fill("隔离验收故障注入：浏览器将中止提交，不登记真实业务结论。");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "检查并保存核对结论" }).click();
  await page.getByRole("button", { name: "确认保存核对结论" }).click();
  await expect(form.getByRole("alert")).toContainText("保存结果暂时无法确认");
  expect(blockedSubmissions).toHaveLength(1);
  expect(blockedSubmissions[0].operationId).toBe(summary.id);
  expect(blockedSubmissions[0].kind).toBe("retry");
  expect(detail.operation.resolutions.some((record) => record.requestId === blockedSubmissions[0].requestId)).toBe(false);
  await expect(page.getByLabel("记录状态")).toBeDisabled();
  await expect(form.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled();

  holdHistory = true;
  await form.getByRole("button", { name: "核对最新记录" }).click();
  await expect.poll(() => heldReads).toBe(1);
  await expect(form.getByRole("status")).toContainText("读取与核对较慢", { timeout: 7000 });
  expect(blockedSubmissions).toHaveLength(1);
  await form.getByRole("button", { name: "中止本次读取" }).focus();
  await page.keyboard.press("Enter");
  await expect(form.getByRole("button", { name: "核对最新记录" })).toBeFocused();
  await expect(form.getByRole("alert")).toContainText("原提交及全部内容仍保留");
  await expect(page.getByLabel("记录状态")).toBeDisabled();
  await expect(form.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled();
  releaseHistory(); holdHistory = false;

  const rereadWait = page.waitForResponse((value) => new URL(value.url()).pathname === path && value.request().method() === "GET");
  await form.getByRole("button", { name: "核对最新记录" }).click();
  const rereadHttp = await rereadWait; expect(rereadHttp.ok()).toBe(true);
  const reread = ToolOperationGetResult.parse(await rereadHttp.json());
  if (!reread.ok) throw new Error("手动重读真实详情失败");
  expect(reread.operation.id).toBe(summary.id); expect(reread.operation.sourceRunId).toBe(summary.sourceRunId);
  expect(reread.operation.resolutions.some((record) => record.requestId === blockedSubmissions[0].requestId)).toBe(false);
  await expect(form.getByRole("alert")).toContainText("仍不能确认本次提交");
  await expect(page.getByLabel("记录状态")).toBeDisabled();
  const location = page.url();
  page.once("dialog", (dialog) => { expect(dialog.type()).toBe("confirm"); void dialog.dismiss(); });
  await page.getByRole("link", { name: "查看这条记录的源任务" }).click();
  await expect(page).toHaveURL(location);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(blockedSubmissions).toHaveLength(1); expect(unexpectedWrites).toEqual([]); expect(errors).toEqual([]);
  const text = await page.locator("main").innerText();
  for (const value of [summary.id, summary.sourceRunId, blockedSubmissions[0].requestId]) expect(text).not.toContain(value);
  await testInfo.attach("读取恢复边界", { body: JSON.stringify({ actualRead: true, heldReads, abortedBeforeServer: blockedSubmissions.length, businessWritesReachedServer: 0, originalSubmissionRecorded: false, unexpectedWrites: unexpectedWrites.length, pageErrors: errors.length }), contentType: "application/json" });
  } finally { releaseHistory(); }
});
