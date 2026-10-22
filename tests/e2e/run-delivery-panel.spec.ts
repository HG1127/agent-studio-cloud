import { expect, test } from "@playwright/test";
import { RunTaskReference } from "../../src/contracts/run-task";
import { RunDeliveryResult, RunDeliveryRetryBody, RunDeliveryRetryResult } from "../../src/contracts/run-delivery";

test("桌面成果投递：读取真实失败记录，真实补投响应丢失后沿用原请求核对", async ({ page }, testInfo) => {
  if (process.env.RUN_DELIVERY_E2E_ALLOW_RETRY !== "1") throw new Error("必须由CI确认隔离Neon及专用防重接收方后，显式允许本规格的真实补投；条件不足不跳过或算通过");
  const reference = RunTaskReference.safeParse({ runId: process.env.RUN_DELIVERY_E2E_RUN_ID });
  if (!reference.success) throw new Error("需要CI准备真实、成果完整、未过期、可人工补投的隔离任务，并提供任务标识；不注入前端假投递记录");
  const runId = reference.data.runId;
  const path = '/api/runs/' + runId + '/delivery';
  const writes: RunDeliveryRetryBody[] = [];
  const unexpectedWrites: string[] = [];
  const errors: string[] = [];
  let recordedAtServer = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const requestPath = new URL(request.url()).pathname;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && !(requestPath === path && request.method() === "POST")) unexpectedWrites.push(requestPath);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const firstRead = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === "GET");
  const pageResponse = await page.goto('/runs/' + runId);
  expect(pageResponse?.ok()).toBe(true);
  const actualRead = await firstRead;
  expect(actualRead.ok()).toBe(true);
  const result = RunDeliveryResult.parse(await actualRead.json());
  if (!result.ok || result.runId !== runId || result.delivery?.status !== "failed") throw new Error("隔离任务必须有真实失败投递记录，不借用无记录、占位或其他任务回执");
  const original = result.delivery;
  if (original.resolutions.length >= 20 || original.retryDeadline !== null && Date.parse(original.retryDeadline) <= Date.now()) throw new Error("真实人工补投记录已达上限或防重期限已过，需CI准备安全可补投的专用隔离数据");
  const panel = page.getByRole("region", { name: "接收状态与人工补投" });
  await expect(panel.getByRole("heading", { name: "发送已停止，需人工核对" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "运行详情区块" }).getByRole("link", { name: "成果投递", exact: true })).toHaveAttribute("href", "#delivery");
  await expect(page.getByRole("button", { name: "复制最终结果" })).toBeEnabled();
  const savedResult = await page.locator("#result").innerText();

  await page.route("**/api/runs/**/delivery", async (route) => {
    if (new URL(route.request().url()).pathname !== path || route.request().method() !== "POST") return route.continue();
    const payload = RunDeliveryRetryBody.parse(route.request().postDataJSON());
    writes.push(payload);
    if (writes.length === 1) {
      const response = await route.fetch();
      const receipt = RunDeliveryRetryResult.parse(await response.json());
      if (!response.ok() || !receipt.ok || receipt.runId !== runId || receipt.deliveryId !== original.id) throw new Error("真实首次补投未获登记，不能用注入成功回执替代");
      recordedAtServer += 1;
      await route.abort("failed");
    } else await route.continue();
  });
  await panel.getByRole("textbox", { name: "补投核对原因" }).fill("隔离验收：已核对专用接收方记录，确认沿用原成果与原防重请求；不涉及生产业务。");
  await panel.getByRole("button", { name: "核对并申请补投" }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "确认申请补投" }).click();
  await expect(panel.getByRole("alert")).toContainText("补投结果尚无法确认");
  await expect(panel.getByRole("textbox", { name: "本次固定的补投原因" })).toHaveAttribute("readonly", "");
  await expect(panel.getByRole("button", { name: "按原请求核对补投" })).toBeDisabled();
  expect(writes).toHaveLength(1);
  expect(recordedAtServer).toBe(1);
  const reread = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === "GET");
  await panel.getByRole("button", { name: "重新读取投递状态" }).click();
  const rereadResponse = await reread;
  expect(rereadResponse.ok()).toBe(true);
  const stored = RunDeliveryResult.parse(await rereadResponse.json());
  if (!stored.ok || stored.runId !== runId || stored.delivery?.id !== original.id) throw new Error("真实重新读取未核对到原投递记录");
  expect(stored.delivery.resolutions.filter((record) => record.requestId === writes[0].requestId)).toHaveLength(1);
  await expect(panel.getByRole("button", { name: "按原请求核对补投" })).toBeEnabled();
  await expect(panel.getByRole("alert")).toContainText("补投结果尚无法确认");
  expect(writes).toHaveLength(1);
  await panel.getByRole("button", { name: "按原请求核对补投" }).click();
  const recheck = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认按原请求核对" }).click();
  const recheckResponse = await recheck;
  expect(recheckResponse.ok()).toBe(true);
  const recheckResult = RunDeliveryRetryResult.parse(await recheckResponse.json());
  if (!recheckResult.ok) throw new Error("真实原请求核对未取得登记回执");
  expect(recheckResult.runId).toBe(runId); expect(recheckResult.deliveryId).toBe(original.id);
  await expect(panel.getByRole("status")).toContainText("补投请求已记录；请重新读取投递状态");
  await expect(panel.getByRole("button", { name: "按原请求核对补投" })).toHaveCount(0);
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  const finalRead = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === "GET");
  await panel.getByRole("button", { name: "重新读取投递状态" }).click();
  const finalResponse = await finalRead; expect(finalResponse.ok()).toBe(true);
  const final = RunDeliveryResult.parse(await finalResponse.json());
  if (!final.ok || final.delivery?.id !== original.id) throw new Error("最后读取未核对到原投递");
  expect(final.delivery.resolutions.filter((record) => record.requestId === writes[0].requestId)).toHaveLength(1);
  expect(final.delivery.resolutions.length).toBe(original.resolutions.length + 1);
  expect(await page.locator("#result").innerText()).toBe(savedResult);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const text = await panel.innerText();
  for (const value of [runId, original.id, original.targetId, writes[0].requestId]) expect(text).not.toContain(value);
  expect(unexpectedWrites).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("真实投递核对范围", { body: JSON.stringify({
    actualRead: true, actualRetryReachedServer: true, firstResponseAbortedAfterRecorded: recordedAtServer,
    submissions: writes.length, sameOriginalRequest: true, addedResolutions: 1, deliveryClaimed: false,
    unexpectedWrites: unexpectedWrites.length, pageErrors: errors.length,
  }), contentType: "application/json" });
});
