import { expect, test } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";
import { VersionExportFile } from "../../src/contracts/version";
import { redactSensitiveData } from "../../src/server/domain/security/redact-sensitive";
import { savedRunResultView } from "../../src/features/runs/run-result-view";
import { inputDefinitionsForFields, inputFieldDescription } from "../../src/features/agents/input-field-description";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });
test.beforeEach(() => {
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1") {
    throw new Error("网页历史试运行原生规格必须使用明确的隔离验收库及演示模型，不能降级到生产资源。");
  }
});

test("桌面试运行真实提交后丢失回执，更换版本提醒且同请求核对不重复建任务", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const agentName = `网页试运行离开保护-${Date.now()}`;
  await page.goto("/agents/new");
  await page.getByLabel("助手名称").fill(agentName);
  await page.getByLabel("想让助手完成什么（至少 10 个字）").fill("收到客户咨询后生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  const agentId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "发布新版本" }).click();
  const exportLink = page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true });
  await expect(exportLink).toHaveCount(1);
  const exportHref = (await exportLink.getAttribute("href"))!;
  const source = await page.request.get(exportHref);
  expect(source.ok()).toBe(true);
  const saved = VersionExportFile.parse(await source.json());
  expect(saved.version.status).toBe("production");
  expect(Object.values(saved.manifest.workflowSnapshot.nodes).some((node) => node.type === "tool")).toBe(false);
  const versionId = exportHref.match(/\/versions\/([0-9a-f-]{36})\/export$/i)?.[1];
  expect(versionId).toBeTruthy();
  const href = `/web-tools?version=${versionId}`;
  await page.goto(href);
  const preview = page.getByRole("region", { name: "网页填写预览" });
  const controls = preview.locator("[data-preview-field-index]");
  await expect(controls).toHaveCount(saved.manifest.inputContract.fields.length);
  const expectedInput: Record<string, unknown> = {};
  for (const [index, field] of saved.manifest.inputContract.fields.entries()) {
    const raw = field.type === "number" ? "0" : field.type === "boolean" ? "false" : field.type === "object" ? "{}" : field.type === "array" ? "[]" : "原请求业务填写\n回执丢失后仍保留原文";
    if (field.type === "boolean") await controls.nth(index).selectOption(raw);
    else await controls.nth(index).fill(raw);
    expectedInput[field.name] = field.type === "string" ? raw : JSON.parse(raw);
  }
  let posts = 0;
  let actualResponseReceived = false;
  await page.route("**/web-tools**", async (route) => {
    if (route.request().method() !== "POST" || ++posts !== 1) { await route.continue(); return; }
    const actualResponse = await route.fetch();
    expect(actualResponse.ok()).toBe(true);
    actualResponseReceived = true;
    await route.abort("failed");
  });
  try {
    await preview.getByRole("button", { name: "用这些填写试运行", exact: true }).click();
    await page.getByRole("dialog", { name: "确认创建真实试运行？" }).getByRole("button", { name: "确认并创建任务", exact: true }).click();
    const retry = preview.getByRole("button", { name: "核对上次试运行", exact: true });
    await expect(retry).toBeVisible({ timeout: 60_000 });
    expect(actualResponseReceived).toBe(true);
    await expect(preview.getByRole("alert")).toContainText("暂时无法确认是否已创建任务");
    for (const control of await controls.all()) await expect(control).toBeDisabled();
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    const warnings: string[] = [];
    page.once("dialog", async (dialog) => { warnings.push(dialog.message()); await dialog.dismiss(); });
    await page.getByRole("button", { name: "核对版本字段", exact: true }).click();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("不能取消后台任务");
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(href);
    expect(posts).toBe(1);
    await expect(retry).toBeVisible();
    page.once("dialog", async (dialog) => { warnings.push(dialog.message()); await dialog.dismiss(); });
    await preview.getByRole("link", { name: "查看这位助手的运行记录", exact: true }).click();
    expect(warnings).toHaveLength(2);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(href);
    expect(posts).toBe(1);
    await retry.click();
    await page.waitForURL((url) => /^\/runs\/[0-9a-f-]+$/.test(url.pathname), { timeout: 60_000 });
    expect(posts).toBe(2);
  } finally { await page.unroute("**/web-tools**"); }
  const runPath = new URL(page.url()).pathname;
  const actual = await page.request.get(`/api${runPath}/export`);
  expect(actual.ok()).toBe(true);
  const report = RunReportFile.parse(await actual.json());
  expect(report.run.agentId).toBe(agentId);
  expect(report.run.versionId).toBe(versionId);
  expect(report.run.sourceType).toBe("manual");
  expect(report.run.input).toEqual(expectedInput);
  await page.goto(`/runs?agent=${agentId}`);
  const runLinks = await page.locator('main a[href^="/runs/"]').evaluateAll((items) => items.map((item) => item.getAttribute("href")));
  const records = new Set(runLinks.filter((link): link is string => link !== null && /^\/runs\/[0-9a-f-]{36}(?:\?|$)/i.test(link)).map((link) => new URL(link, "https://local.invalid").pathname));
  expect([...records]).toEqual([runPath]);
});

test("桌面网页试填确认后真实启动、审批恢复并核对保存的输入与版本", async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const agentName = `网页工具试运行验收-${Date.now()}`;
  await page.goto("/agents/new");
  await page.getByLabel("助手名称").fill(agentName);
  await page.getByLabel("想让助手完成什么（至少 10 个字）").fill("收到客户咨询后生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  const agentId = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect(page.locator('[data-testid^="rf__node-"]').getByText("负责人确认发送内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发布新版本" }).click();
  const exportLink = page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true });
  await expect(exportLink).toHaveCount(1);
  const exportHref = (await exportLink.getAttribute("href"))!;
  const versionId = exportHref.match(/\/versions\/([0-9a-f-]{36})\/export$/i)?.[1];
  expect(versionId).toBeTruthy();
  const exported = await page.request.get(exportHref);
  expect(exported.ok()).toBe(true);
  const saved = VersionExportFile.parse(await exported.json());
  expect(saved.version.status).toBe("production");
  expect(Object.values(saved.manifest.workflowSnapshot.nodes).some((node) => node.type === "tool")).toBe(false);
  await page.goto(`/web-tools?version=${versionId}`);
  const preview = page.getByRole("region", { name: "网页填写预览" });
  const controls = preview.locator("[data-preview-field-index]");
  await expect(controls).toHaveCount(saved.manifest.inputContract.fields.length);
  const expectedInput: Record<string, unknown> = {};
  for (const [index, field] of saved.manifest.inputContract.fields.entries()) {
    const raw = field.type === "number" ? "0" : field.type === "boolean" ? "false" : field.type === "object" ? "{}" : field.type === "array" ? "[]" : "  网页真实业务填写\n保留第二行  " + "核对内容".repeat(1300);
    if (field.type === "boolean") await controls.nth(index).selectOption(raw);
    else await controls.nth(index).fill(raw);
    if (field.type === "string") {
      expect(raw.length).toBeGreaterThan(4000);
      await expect(controls.nth(index)).toHaveValue(raw);
      await expect(controls.nth(index)).not.toHaveAttribute("maxlength", "4000");
    }
    expectedInput[field.name] = field.type === "string" ? raw : JSON.parse(raw);
  }
  const startButton = preview.getByRole("button", { name: "用这些填写试运行" });
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await startButton.click();
  const dialog = page.getByRole("dialog", { name: "确认创建真实试运行？" });
  await expect(dialog).toContainText(agentName);
  await expect(dialog).toContainText(`指定「${agentName}」的版本 ${saved.version.number}`);
  await expect(dialog).toContainText("不会自动改用后来发布的新版本");
  await expect(dialog).toContainText("创建记录不等于已执行、已完成或通过验收");
  await expect(dialog).toContainText("不是网页工具的公开调用");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/web-tool-trial-confirm-desktop.png" });
  await dialog.getByRole("button", { name: "返回", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(startButton).toBeFocused();
  for (const [index, field] of saved.manifest.inputContract.fields.entries()) {
    if (field.type === "string") await expect(controls.nth(index)).toHaveValue(expectedInput[field.name] as string);
  }
  expect(writes).toEqual([]);

  let release!: () => void;
  let submitted!: () => void;
  const holdRequest = new Promise<void>((resolve) => { release = resolve; });
  const requestStarted = new Promise<void>((resolve) => { submitted = resolve; });
  await page.route("**/web-tools**", async (route) => {
    if (route.request().method() === "POST") { submitted(); await holdRequest; }
    await route.continue();
  });
  try {
    await startButton.click();
    await dialog.getByRole("button", { name: "确认并创建任务" }).click();
    await requestStarted;
    await expect(dialog.getByRole("button", { name: "正在处理…" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "返回", exact: true })).toBeDisabled();
    for (const control of await controls.all()) await expect(control).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(writes).toEqual(["/web-tools"]);
  } finally { release(); }
  await page.waitForURL((url) => /^\/runs\/[0-9a-f-]+$/.test(url.pathname), { timeout: 60_000 });
  await page.unroute("**/web-tools**");
  const runPath = new URL(page.url()).pathname;
  const returnHref = `/web-tools?version=${versionId}&trial=${runPath.split("/").at(-1)}`;
  expect(new URL(page.url()).searchParams.get("from")).toBe(returnHref);
  await expect(page.getByRole("link", { name: "返回网页工具", exact: true })).toHaveAttribute("href", returnHref);
  await expect(page.getByRole("heading", { name: "确认后才能继续" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText(`运行版本：版本 ${saved.version.number}`, { exact: true })).toBeVisible();
  const savedWrites = [...writes];
  const eventsPath = "/api" + runPath + "/events";
  const isWebStream = (response: import("@playwright/test").Response) => new URL(response.url()).pathname === eventsPath
    && new URL(response.url()).searchParams.get("after") === "0" && response.request().method() === "GET";
  const streamReply = page.waitForResponse(isWebStream);
  await page.getByRole("link", { name: "返回网页工具", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === returnHref);
  const updates = page.getByRole("region", { name: "本次任务自动更新", exact: true });
  await expect(updates).toBeVisible();
  const streamResponse = await streamReply;
  expect(streamResponse.status()).toBe(200);
  expect(streamResponse.headers()["content-type"]).toContain("text/event-stream");
  await updates.getByRole("button", { name: "暂停本页自动更新", exact: true }).click();
  await expect(updates.getByRole("status")).toContainText("任务仍按原状态执行");
  expect(writes).toEqual(savedWrites);
  const restoredReply = page.waitForResponse(isWebStream);
  await updates.getByRole("button", { name: "恢复本页自动更新", exact: true }).click();
  expect((await restoredReply).status()).toBe(200);
  expect(writes).toEqual(savedWrites);
  await page.getByRole("region", { name: "内部运行结果", exact: true }).getByRole("link", { name: "打开任务处理待办", exact: true }).click();
  await page.waitForURL((url) => url.pathname === runPath);
  await expect(page.getByRole("heading", { name: "确认后才能继续" })).toBeVisible();
  await page.getByRole("button", { name: "批准并继续" }).click();
  const completed = page.getByRole("heading", { name: "结果与执行证据已保存" });
  const recovery = page.getByRole("region", { name: "负责人确认发送内容确认记录" }).getByRole("button", { name: "继续运行", exact: true });
  await expect(completed.or(recovery).first()).toBeVisible({ timeout: 180_000 });
  if (await recovery.isVisible()) {
    await expect(page.getByText("处理决定已保存，运行仍在等待恢复。", { exact: true })).toBeVisible();
    await recovery.click();
  }
  await expect(completed).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("流程执行完成", { exact: true })).toBeVisible();
  const reportResponse = await page.request.get(`/api${runPath}/export`);
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.agentId).toBe(agentId);
  expect(report.run.versionId).toBe(versionId);
  expect(report.run.input).toEqual(expectedInput);
  expect(report.run.sourceType).toBe("manual");
  expect(report.run.status).toBe("completed");
  expect(report.run.result).not.toBeNull();
  expect(report.approvals.some((approval) => approval.status === "approved")).toBe(true);
  expect(report.trace.some((event) => event.title.includes("流程执行完成"))).toBe(true);
  expect(writes.filter((path) => path === "/web-tools")).toHaveLength(1);
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.locator("#result").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/web-tool-trial-result-desktop.png" });
  }
  writes.length = 0;
  await page.getByRole("link", { name: "返回网页工具", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === returnHref);
  const result = page.getByRole("region", { name: "内部运行结果", exact: true });
  await expect(result.getByRole("heading", { name: "已保存的交付结果", exact: true })).toBeVisible();
  await expect(result.getByRole("region", { name: "本次任务自动更新", exact: true })).toHaveCount(0);
  await expect(result).toContainText(`实际版本 ${saved.version.number}`);
  await expect(result).toContainText("不是网页工具的外部调用记录");
  await result.getByText("查看已保存结果（开发者数据）", { exact: true }).click();
  await expect(result.getByText("查看已保存结果（开发者数据）", { exact: true }).locator("..").locator("pre")).toHaveText(JSON.stringify(redactSensitiveData(report.run.result), null, 2));
  const savedResult = savedRunResultView(report.run);
  const expectedCopy = savedResult.copyText || (typeof savedResult.redactedResult === "string" ? savedResult.redactedResult : JSON.stringify(savedResult.redactedResult, null, 2));
  await result.getByRole("button", { name: "复制已保存内容", exact: true }).click();
  await expect(result.getByRole("status").filter({ hasText: /^已复制$/ })).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(expectedCopy);
  const deliveryItems = result.getByRole("list", { name: "已保存的交付内容" }).locator(":scope > li");
  for (const [index, output] of savedResult.outputs.entries()) {
    const copy = deliveryItems.nth(index).getByRole("button", { name: `复制${output.label}`, exact: true });
    await copy.click();
    await expect(deliveryItems.nth(index).getByRole("status")).toHaveText("已复制");
    const expectedField = typeof output.output === "string" ? output.output : JSON.stringify(output.output, null, 2);
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(expectedField);
  }
  await result.getByText("核对本次保存的输入", { exact: true }).click();
  const inputCoverage = result.getByRole("region", { name: "保存输入覆盖核对", exact: true });
  await expect(inputCoverage).toBeVisible();
  const coverageRows = inputCoverage.getByRole("list", { name: "本次输入约定覆盖情况", exact: true }).locator(":scope > li");
  await expect(coverageRows).toHaveCount(report.run.inputContract.fields.length);
  for (const [index, field] of saved.manifest.inputContract.fields.entries()) {
    const label = field.label?.trim() || `业务信息 ${index + 1}`;
    await expect(coverageRows.nth(index).getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(coverageRows.nth(index)).toContainText("已记录，基础格式相符");
  }
  await inputCoverage.getByText("查看完整保存输入（开发者数据）", { exact: true }).click();
  await expect(inputCoverage.locator("pre")).toHaveText(JSON.stringify(redactSensitiveData(report.run.input), null, 2));
  await expect(inputCoverage.getByRole("button", { name: /启动|提交|保存|补入/ })).toHaveCount(0);
  const layouts = result.getByRole("group", { name: "已保存结果布局" });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await layouts.getByRole("button", { name: "交付清单", exact: true }).click();
    await expect(layouts.getByRole("button", { name: "交付清单", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await layouts.getByRole("button", { name: "字段卡片", exact: true }).click();
  }
  await result.getByText("查看已保存结果（开发者数据）", { exact: true }).click();
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/web-tool-saved-delivery-desktop.png" });
  }
  await result.getByRole("link", { name: "查看本次任务与执行证据", exact: true }).click();
  await page.waitForURL((url) => url.pathname === runPath);
  await page.getByRole("link", { name: "返回网页工具", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === returnHref);
  await page.reload();
  await expect(page.getByRole("region", { name: "内部运行结果", exact: true }).getByRole("heading", { name: "已保存的交付结果", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole("link", { name: "移除本次关联", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === `/web-tools?version=${versionId}`);
  await expect(page.getByText(/当前没有关联任务/)).toBeVisible();
  const retained = await page.request.get(`/api${runPath}/export`);
  expect(retained.ok()).toBe(true);
  expect(RunReportFile.parse(await retained.json()).run.id).toBe(report.run.id);
  expect(writes).toEqual([]);
});

test("选定正式版本后另一页真实发布更新，原页面仍指定已转历史的原版本而不漂移", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const agentName = `网页固定版本验收-${Date.now()}`;
  await page.goto("/agents/new");
  await page.getByLabel("助手名称").fill(agentName);
  await page.getByLabel("想让助手完成什么（至少 10 个字）").fill("收到客户咨询后生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  const agentPath = new URL(page.url()).pathname;
  const agentId = agentPath.split("/").at(-1)!;
  await page.getByRole("button", { name: "发布新版本" }).click();
  const downloads = page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true });
  await expect(downloads).toHaveCount(1);
  const selectedExportHref = (await downloads.getAttribute("href"))!;
  const selectedVersionId = selectedExportHref.match(/\/versions\/([0-9a-f-]{36})\/export$/i)?.[1];
  expect(selectedVersionId).toBeTruthy();
  const selectedResponse = await page.request.get(selectedExportHref);
  expect(selectedResponse.ok()).toBe(true);
  const selected = VersionExportFile.parse(await selectedResponse.json());
  expect(selected.version.status).toBe("production");
  expect(Object.values(selected.manifest.workflowSnapshot.nodes).some((node) => node.type === "tool")).toBe(false);
  const selectedHref = `/web-tools?version=${selectedVersionId}`;
  await page.goto(selectedHref);
  const preview = page.getByRole("region", { name: "网页填写预览", exact: true });
  const controls = preview.locator("[data-preview-field-index]");
  await expect(controls).toHaveCount(selected.manifest.inputContract.fields.length);
  const expectedInput: Record<string, unknown> = {};
  for (const [index, field] of selected.manifest.inputContract.fields.entries()) {
    const raw = field.type === "number" ? "0" : field.type === "boolean" ? "false" : field.type === "object" ? "{}" : field.type === "array" ? "[]" : "  旧正式版本的真实填写\n发布更新后仍保留  ";
    if (field.type === "boolean") await controls.nth(index).selectOption(raw);
    else await controls.nth(index).fill(raw);
    expectedInput[field.name] = field.type === "string" ? raw : JSON.parse(raw);
  }
  const publisher = await page.context().newPage();
  let currentVersionId: string | undefined;
  let currentSource: VersionExportFile | undefined;
  try {
    await publisher.goto(agentPath);
    await publisher.locator('[data-testid^="rf__node-"]').getByText("负责人确认发送内容", { exact: true }).click();
    await publisher.getByRole("textbox", { name: "节点名称", exact: true }).fill("负责人确认更新版发送内容");
    await publisher.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(publisher.getByText("草稿已保存", { exact: true })).toBeVisible();
    await expect(publisher.getByRole("button", { name: "发布新版本", exact: true })).toBeEnabled();
    await publisher.getByRole("button", { name: "发布新版本", exact: true }).click();
    const updatedDownloads = publisher.locator("#versions").getByRole("link", { name: "下载此版本", exact: true });
    await expect(updatedDownloads).toHaveCount(2);
    const hrefs = await updatedDownloads.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const currentExportHref = hrefs.find((href) => href && href !== selectedExportHref);
    expect(currentExportHref).toBeTruthy();
    const currentResponse = await publisher.request.get(currentExportHref!);
    expect(currentResponse.ok()).toBe(true);
    const current = VersionExportFile.parse(await currentResponse.json());
    currentSource = current;
    currentVersionId = currentExportHref!.match(/\/versions\/([0-9a-f-]{36})\/export$/i)?.[1];
    expect(currentVersionId).toBeTruthy();
    expect(current.version.status).toBe("production");
    expect(current.version.number).toBeGreaterThan(selected.version.number);
    expect(currentExportHref).not.toContain(selectedVersionId!);
    expect(Object.values(current.manifest.workflowSnapshot.nodes).some((node) => node.title === "负责人确认更新版发送内容")).toBe(true);
    const retiredResponse = await publisher.request.get(selectedExportHref);
    expect(retiredResponse.ok()).toBe(true);
    const retired = VersionExportFile.parse(await retiredResponse.json());
    expect(retired.version.status).toBe("retired");
    expect(retired.manifest.workflowSnapshot).toEqual(selected.manifest.workflowSnapshot);
  } finally { await publisher.close(); }
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(selectedHref);
  for (const [index, field] of selected.manifest.inputContract.fields.entries()) {
    if (field.type === "string") await expect(controls.nth(index)).toHaveValue(expectedInput[field.name] as string);
  }
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await preview.getByRole("button", { name: "用这些填写试运行", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认创建真实试运行？" });
  await expect(dialog).toContainText(`指定「${agentName}」的版本 ${selected.version.number}`);
  await expect(dialog).toContainText("指定版本是否可用由服务端核对");
  await expect(dialog).toContainText("不会自动改用后来发布的新版本");
  await dialog.getByRole("button", { name: "确认并创建任务", exact: true }).click();
  await page.waitForURL((url) => /^\/runs\/[0-9a-f-]+$/.test(url.pathname), { timeout: 60_000 });
  const runPath = new URL(page.url()).pathname;
  const reportResponse = await page.request.get(`/api${runPath}/export`);
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.agentId).toBe(agentId);
  expect(report.run.versionId).toBe(selectedVersionId);
  expect(report.run.version).toBe(selected.version.number);
  expect(report.run.sourceType).toBe("manual");
  expect(report.run.input).toEqual(expectedInput);
  expect(new URL(page.url()).searchParams.get("from")).toBe(`/web-tools?version=${selectedVersionId}&trial=${report.run.id}`);
  expect(writes.filter((path) => path === "/web-tools")).toHaveLength(1);
  const savedReturnHref = `/web-tools?version=${selectedVersionId}&trial=${report.run.id}`;
  await page.getByRole("link", { name: "返回网页工具", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === savedReturnHref);
  await expect(page.getByRole("region", { name: "核对所选历史版本", exact: true })).toBeVisible();
  await expect(page.getByText("所选历史版本的已保存来源", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "用于核对的助手版本", exact: true })).toHaveValue(selectedVersionId!);
  await page.reload();
  await expect(page.getByRole("region", { name: "核对所选历史版本", exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(savedReturnHref);
  const definitions = inputDefinitionsForFields(selected.manifest.inputContract.fields, selected.manifest.workflowSnapshot.variables);
  await expect(controls).toHaveCount(selected.manifest.inputContract.fields.length);
  for (const [index, field] of selected.manifest.inputContract.fields.entries()) {
    const label = field.label?.trim() || `业务信息 ${index + 1}`;
    await expect(preview.getByLabel(`${label}（${field.required ? "必填" : "选填"}）`, { exact: true })).toBeVisible();
    const description = inputFieldDescription(field, definitions);
    if (description) expect(await controls.nth(index).getAttribute("aria-describedby")).toBeTruthy();
    if (description) await expect(preview.getByText(description, { exact: true })).toBeVisible();
  }
  expect(writes.filter((path) => path === "/web-tools")).toHaveLength(1);
  await page.getByRole("link", { name: "只读核对这个版本的流程", exact: true }).click();
  await page.waitForURL((url) => url.pathname === `${agentPath}/versions/${selectedVersionId}`);
  await expect(page.getByLabel("冻结流程只读画布", { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="rf__node-"]').getByText("负责人确认发送内容", { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="rf__node-"]').getByText("负责人确认更新版发送内容", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "返回网页工具", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === selectedHref);
  await expect(page.getByRole("region", { name: "核对所选历史版本", exact: true })).toBeVisible();
  expect(writes.filter((path) => path === "/web-tools")).toHaveLength(1);
  for (const [index, field] of selected.manifest.inputContract.fields.entries()) {
    const raw = field.type === "string" ? expectedInput[field.name] as string : JSON.stringify(expectedInput[field.name]);
    if (typeof raw !== "string") throw new Error("旧版本的实际填写尚未读全，不能补造试运行输入。");
    if (field.type === "boolean") await controls.nth(index).selectOption(raw);
    else await controls.nth(index).fill(raw);
  }
  await preview.getByRole("button", { name: "用这些填写试运行", exact: true }).click();
  await expect(dialog).toContainText(`指定「${agentName}」的版本 ${selected.version.number}`);
  await dialog.getByRole("button", { name: "确认并创建任务", exact: true }).click();
  await page.waitForURL((url) => /^\/runs\/[0-9a-f-]+$/.test(url.pathname), { timeout: 60_000 });
  const freshPath = new URL(page.url()).pathname;
  const freshResponse = await page.request.get(`/api${freshPath}/export`);
  expect(freshResponse.ok()).toBe(true);
  const fresh = RunReportFile.parse(await freshResponse.json());
  expect(fresh.run.id).not.toBe(report.run.id);
  expect(fresh.run.agentId).toBe(agentId); expect(fresh.run.versionId).toBe(selectedVersionId);
  expect(fresh.run.version).toBe(selected.version.number); expect(fresh.run.input).toEqual(expectedInput);
  expect(fresh.run.sourceType).toBe("manual");
  expect(writes.filter((path) => path === "/web-tools")).toHaveLength(2);
  await page.getByRole("link", { name: "返回网页工具", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === `/web-tools?version=${selectedVersionId}&trial=${fresh.run.id}`);
  expect(currentVersionId).toBeTruthy(); expect(currentSource).toBeDefined();
  await page.getByRole("combobox", { name: "用于核对的助手版本", exact: true }).selectOption(currentVersionId!);
  await page.getByRole("button", { name: "核对版本字段", exact: true }).click();
  await page.waitForURL((url) => url.pathname + url.search === `/web-tools?version=${currentVersionId}`);
  expect(new URL(page.url()).searchParams.has("trial")).toBe(false);
  await expect(page.getByText("当前正式版本的已保存来源", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "用于核对的助手版本", exact: true }).locator(`option[value="${selectedVersionId}"]`)).toHaveCount(0);
  await expect(controls).toHaveCount(currentSource!.manifest.inputContract.fields.length);
  const retainedResponse = await page.request.get(selectedExportHref);
  expect(retainedResponse.ok()).toBe(true);
  expect(VersionExportFile.parse(await retainedResponse.json()).version.status).toBe("retired");
  const retainedRun = await page.request.get(`/api${runPath}/export`);
  expect(retainedRun.ok()).toBe(true);
  expect(RunReportFile.parse(await retainedRun.json()).run.input).toEqual(expectedInput);
  expect(writes.every((path) => path === "/web-tools")).toBe(true);
  expect(writes.filter((path) => path === "/web-tools")).toHaveLength(2);
});

test("桌面网页结果拒绝重复或无版本的关联，不自动选取任务且只读恢复", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/runs?source=manual");
  const links = await page.locator('main a[href^="/runs/"]').evaluateAll((items) => items.map((item) => item.getAttribute("href")));
  const runPath = links.find((href) => href && /^\/runs\/[0-9a-f-]{36}(?:\?|$)/i.test(href));
  expect(runPath).toBeTruthy();
  const id = new URL(runPath!, "https://local.invalid").pathname.split("/").at(-1)!;
  const response = await page.request.get(`/api/runs/${id}/export`);
  expect(response.ok()).toBe(true);
  const report = RunReportFile.parse(await response.json());
  expect(report.run.sourceType).toBe("manual");
  expect(report.run.versionId).not.toBeNull();
  const versionId = report.run.versionId!;
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  for (const href of [`/web-tools?version=${versionId}&trial=${id}&trial=${id}`, `/web-tools?version=${versionId}&version=${versionId}&trial=${id}`, `/web-tools?trial=${id}`]) {
    await page.goto(href);
    await expect(page.getByRole("alert").filter({ hasText: "网址中的版本或运行选择无法核对" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "已保存的交付结果", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "内部试运行", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "等待选择正式版本", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole("link", { name: "清除网址选择，重新核对", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/web-tools" && !url.search);
  await expect(page.getByText(/当前没有关联任务/)).toBeVisible();
  expect(writes).toEqual([]);
  const retained = await page.request.get(`/api/runs/${id}/export`);
  expect(retained.ok()).toBe(true);
  expect(RunReportFile.parse(await retained.json()).run.id).toBe(id);
});
