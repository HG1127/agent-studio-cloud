import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";
import { VersionExportFile } from "../../src/contracts/version";

function requireIsolatedRun(testInfo: TestInfo) {
  const base = testInfo.project.use.baseURL;
  const hostname = typeof base === "string" ? new URL(base).hostname : "";
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("须由专用CI先证明隔离数据库归属、显式配置演示模型及本机验收服务，才能创建真实任务；条件不足不跳过、不回退生产环境");
  }
}

async function createAndPublish(page: Page, name: string) {
  await page.goto("/agents/new");
  await page.getByLabel("助手名称").fill(name);
  await page.getByLabel("想让助手完成什么（至少 10 个字）").fill("收到客户咨询后生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手", exact: true }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/i, { timeout: 60000 });
  const agentPath = new URL(page.url()).pathname;
  const agentId = agentPath.split("/").at(-1)!;
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  const downloads = page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true });
  await expect(downloads).toHaveCount(1);
  const exportHref = (await downloads.getAttribute("href"))!;
  const versionId = exportHref.match(/\/versions\/([0-9a-f-]{36})\/export$/i)?.[1];
  expect(versionId).toBeTruthy();
  const response = await page.request.get(exportHref);
  expect(response.ok()).toBe(true);
  const saved = VersionExportFile.parse(await response.json());
  expect(saved.version.status).toBe("production");
  if (Object.values(saved.manifest.workflowSnapshot.nodes).some((node) => node.type === "tool")) throw new Error("隔离原生路径不允许调用外部业务工具");
  if (!saved.manifest.inputContract.fields.some((field) => field.type === "string")) throw new Error("真实场景未提供正文输入，不能把空输入算作多行原文验收");
  const launcher = page.locator("#run");
  await expect(launcher.getByText(`正式版本 V${saved.version.number}`, { exact: true })).toBeVisible();
  return { agentId, agentPath, versionId: versionId!, exportHref, saved };
}

async function fillSavedFields(page: Page, saved: ReturnType<typeof VersionExportFile.parse>) {
  const launcher = page.locator("#run");
  const expectedInput: Record<string, unknown> = {};
  for (const [index, field] of saved.manifest.inputContract.fields.entries()) {
    const label = `${field.label?.trim() || `业务信息 ${index + 1}`}（${field.required ? "必填" : "选填"}）`;
    const control = launcher.getByLabel(label, { exact: true });
    const raw = field.type === "number" ? "0" : field.type === "boolean" ? "false" : field.type === "object" ? '{"说明":"真实业务对象"}' : field.type === "array" ? '[0,false,"真实条目"]' : "  原版本真实业务填写\n发布更新后仍完整保留  " + "业务材料".repeat(1300);
    if (field.type === "boolean") await control.selectOption(raw);
    else await control.fill(raw);
    if (field.type === "string") {
      await expect(control).toHaveValue(raw);
      expect(await control.evaluate((element) => element.tagName)).toBe("TEXTAREA");
      await expect(control).not.toHaveAttribute("maxlength");
      expect(raw.length).toBeGreaterThan(4000);
    }
    expectedInput[field.name] = field.type === "string" ? raw : JSON.parse(raw);
  }
  return expectedInput;
}

test("助手桌面两页真实发布更替后，原表单指定已转历史的原版并保存精确多行输入", async ({ page }, testInfo) => {
  test.setTimeout(300000); requireIsolatedRun(testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  const selected = await createAndPublish(page, "助手固定版本核对-" + Date.now());
  const expectedInput = await fillSavedFields(page, selected.saved);
  const publisher = await page.context().newPage();
  let currentVersionId: string | null = null;
  try {
    await publisher.goto(selected.agentPath);
    await publisher.locator('[data-testid^="rf__node-"]').getByText("负责人确认发送内容", { exact: true }).click();
    await publisher.getByRole("textbox", { name: "节点名称", exact: true }).fill("负责人确认更新版发送内容");
    await publisher.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(publisher.getByText("草稿已保存", { exact: true })).toBeVisible();
    await expect(publisher.getByRole("button", { name: "发布新版本", exact: true })).toBeEnabled();
    await publisher.getByRole("button", { name: "发布新版本", exact: true }).click();
    const downloads = publisher.locator("#versions").getByRole("link", { name: "下载此版本", exact: true });
    await expect(downloads).toHaveCount(2);
    const hrefs = await downloads.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const nextHref = hrefs.find((href) => href && href !== selected.exportHref);
    expect(nextHref).toBeTruthy();
    currentVersionId = nextHref!.match(/\/versions\/([0-9a-f-]{36})\/export$/i)?.[1] ?? "";
    expect(currentVersionId).toBeTruthy(); expect(currentVersionId).not.toBe(selected.versionId);
    const currentResponse = await publisher.request.get(nextHref!);
    expect(currentResponse.ok()).toBe(true);
    const current = VersionExportFile.parse(await currentResponse.json());
    expect(current.version.status).toBe("production"); expect(current.version.number).toBeGreaterThan(selected.saved.version.number);
    expect(Object.values(current.manifest.workflowSnapshot.nodes).some((node) => node.title === "负责人确认更新版发送内容")).toBe(true);
    const retiredResponse = await publisher.request.get(selected.exportHref);
    expect(retiredResponse.ok()).toBe(true);
    const retired = VersionExportFile.parse(await retiredResponse.json());
    expect(retired.version.status).toBe("retired"); expect(retired.manifest.workflowSnapshot).toEqual(selected.saved.manifest.workflowSnapshot);
  } finally { await publisher.close(); }
  expect(currentVersionId).not.toBeNull();
  expect(new URL(page.url()).pathname).toBe(selected.agentPath);
  const launcher = page.locator("#run");
  await expect(launcher.getByText(`正式版本 V${selected.saved.version.number}`, { exact: true })).toBeVisible();
  await expect(launcher).toContainText("不会自动改用后来发布的新版本");
  await expect(launcher).toContainText("创建记录不等于已执行、已完成或通过验收");
  for (const [index, field] of selected.saved.manifest.inputContract.fields.entries()) {
    if (field.type === "string") await expect(launcher.getByLabel(`${field.label?.trim() || `业务信息 ${index + 1}`}（${field.required ? "必填" : "选填"}）`, { exact: true })).toHaveValue(expectedInput[field.name] as string);
  }
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await launcher.getByRole("button", { name: "开始试运行", exact: true }).click();
  await page.waitForURL((url) => /^\/runs\/[0-9a-f-]{36}$/i.test(url.pathname), { timeout: 60000 });
  const runPath = new URL(page.url()).pathname;
  const reportResponse = await page.request.get("/api" + runPath + "/export");
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.agentId).toBe(selected.agentId); expect(report.run.versionId).toBe(selected.versionId);
  expect(report.run.versionId).not.toBe(currentVersionId!);
  expect(report.run.version).toBe(selected.saved.version.number);
  expect(report.run.sourceType).toBe("manual"); expect(report.run.input).toEqual(expectedInput);
  expect(writes.filter((path) => path === selected.agentPath)).toHaveLength(1);
  await testInfo.attach("已保存的固定版本与输入核对", { body: JSON.stringify({ version: report.run.version, specifiedVersionMatches: report.run.versionId === selected.versionId, savedInputMatches: JSON.stringify(report.run.input) === JSON.stringify(expectedInput) }), contentType: "application/json" });
});

test("助手原生启动真实回执丢失后只手动核对原版本与原输入，不重复建立任务", async ({ page }, testInfo) => {
  test.setTimeout(240000); requireIsolatedRun(testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  const selected = await createAndPublish(page, "助手原请求核对-" + Date.now());
  const expectedInput = await fillSavedFields(page, selected.saved);
  const launcher = page.locator("#run");
  let posts = 0; let realReplyReceived = false;
  await page.route("**" + selected.agentPath, async (route) => {
    if (route.request().method() !== "POST" || ++posts !== 1) { await route.continue(); return; }
    const response = await route.fetch(); expect(response.ok()).toBe(true); realReplyReceived = true;
    await route.abort("failed");
  });
  try {
    await launcher.getByRole("button", { name: "开始试运行", exact: true }).click();
    await expect(launcher.getByRole("button", { name: "核对上次启动", exact: true })).toBeVisible({ timeout: 60000 });
    expect(realReplyReceived).toBe(true); expect(posts).toBe(1);
    await expect(launcher.getByRole("alert")).toContainText("暂时无法确认是否已创建运行");
    for (const control of await launcher.locator("textarea,input,select").all()) await expect(control).toBeDisabled();
    for (const [index, field] of selected.saved.manifest.inputContract.fields.entries()) {
      if (field.type === "string") await expect(launcher.getByLabel(`${field.label?.trim() || `业务信息 ${index + 1}`}（${field.required ? "必填" : "选填"}）`, { exact: true })).toHaveValue(expectedInput[field.name] as string);
    }
    await launcher.getByRole("button", { name: "核对上次启动", exact: true }).click();
    await page.waitForURL((url) => /^\/runs\/[0-9a-f-]{36}$/i.test(url.pathname), { timeout: 60000 });
    expect(posts).toBe(2);
  } finally { await page.unroute("**" + selected.agentPath); }
  const runPath = new URL(page.url()).pathname;
  const reportResponse = await page.request.get("/api" + runPath + "/export");
  expect(reportResponse.ok()).toBe(true);
  const report = RunReportFile.parse(await reportResponse.json());
  expect(report.run.agentId).toBe(selected.agentId); expect(report.run.versionId).toBe(selected.versionId);
  expect(report.run.input).toEqual(expectedInput); expect(report.run.sourceType).toBe("manual");
  await page.goto("/runs?agent=" + selected.agentId);
  const links = await page.locator('main a[href^="/runs/"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  const paths = new Set(links.filter((href): href is string => href !== null && /^\/runs\/[0-9a-f-]{36}(?:\?|$)/i.test(href)).map((href) => new URL(href, "https://local.invalid").pathname));
  expect([...paths]).toEqual([runPath]);
});
