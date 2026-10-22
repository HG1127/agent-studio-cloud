import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page, type Request, type Response, type TestInfo } from "@playwright/test";
import { KnowledgeUploadResult } from "../../src/contracts/knowledge";

type SuccessfulUpload = Extract<ReturnType<typeof KnowledgeUploadResult.parse>, { ok: true }>;

function requireIsolatedUpload(testInfo: TestInfo) {
  const base = testInfo.project.use.baseURL;
  const hostname = typeof base === "string" ? new URL(base).hostname : "";
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("须由专用CI先证明隔离数据库归属并配置本机验收服务，才能真实上传资料；条件不足不跳过、不回退生产环境");
  }
}

function isUploadResponse(response: Response) {
  return new URL(response.url()).pathname === "/api/knowledge/sources" && response.request().method() === "POST";
}

async function readSuccessfulUpload(response: Response): Promise<SuccessfulUpload> {
  expect(response.ok(), "真实上传接口必须给出成功HTTP回执，启动不明或失败不能冒充成功").toBe(true);
  const result = KnowledgeUploadResult.parse(await response.json());
  expect(result.ok, "真实共享契约必须确认上传成功，不能借静态占位内容通过").toBe(true);
  if (!result.ok) throw new Error("真实上传接口未确认成功，原生正向路径未完成");
  return result;
}

async function holdFirstUpload(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let receive!: (request: Request) => void;
  const received = new Promise<Request>((resolve) => { receive = resolve; });
  let held = false;
  await page.route("**/api/knowledge/sources", async (route) => {
    if (route.request().method() !== "POST" || held) { await route.continue(); return; }
    held = true;
    receive(route.request());
    await released;
    await route.continue();
  });
  return { received, release, close: async () => { release(); await page.unroute("**/api/knowledge/sources"); } };
}

async function expectNotice(upload: Locator, result: SuccessfulUpload) {
  const notice = upload.getByRole("status");
  await expect(notice).toContainText(result.deduped ? "这份文件已有记录，未重复创建。" : "资料已接收。");
  const statusText = result.source.status === "indexed" ? "当前已就绪，可在资料库中检索。"
    : result.source.status === "parsing" ? "当前正在解析，完成后才能用于资料检索。"
      : result.source.status === "failed" ? "解析失败，请在资料列表查看原因。" : "请在资料列表核对当前状态。";
  await expect(notice).toContainText(statusText);
  if (result.blobStored) await expect(notice).not.toContainText("原文件尚未保存");
  else await expect(notice).toContainText("原文件尚未保存；以后无法直接重新解析，需要重新上传同一文件。");
  await expect(upload.getByRole("alert")).toHaveCount(0);
}

async function expectSavedRecord(page: Page, result: SuccessfulUpload) {
  await page.goto(`/knowledge?source=${encodeURIComponent(result.source.name)}`);
  const record = page.getByRole("region", { name: "公司资料", exact: true }).getByRole("listitem")
    .filter({ has: page.getByText(result.source.name, { exact: true }) });
  await expect(record).toHaveCount(1);
  await expect(record).toContainText(`${(result.source.sizeBytes / 1024).toFixed(1)} KB`);
  const download = record.getByRole("link", { name: "下载原文件", exact: true });
  if (result.source.hasOriginal) await expect(download).toHaveAttribute("href", `/api/knowledge/sources/${result.source.id}/file`);
  else await expect(download).toHaveCount(0);
  await record.getByRole("button", { name: "查看资料", exact: true }).click();
  const details = page.getByRole("dialog", { name: "资料记录详情", exact: true });
  await expect(details).toContainText(result.source.name);
  await expect(details).toContainText("不是全文预览");
  await page.keyboard.press("Escape");
  await expect(details).toBeHidden();
}

async function requireReadyForOldNameDedup(page: Page, first: SuccessfulUpload) {
  const reader = await page.context().newPage();
  try {
    await expect.poll(async () => {
      await reader.goto(`/knowledge?source=${encodeURIComponent(first.source.name)}`);
      const record = reader.getByRole("region", { name: "公司资料", exact: true }).getByRole("listitem")
        .filter({ has: reader.getByText(first.source.name, { exact: true }) });
      return record.getByText("已就绪", { exact: true }).count();
    }, { timeout: 60000, intervals: [500, 1000, 3000], message: "真实解析须已就绪才能核对保留旧名称的普通去重；失败重传会合法更名，不能误当UI错配" }).toBe(1);
  } finally { await reader.close(); }
}

test("桌面真实资料上传在等待回执期间锁定选择器，同事件提交只发送一份原文件", async ({ page }, testInfo) => {
  test.setTimeout(180000); requireIsolatedUpload(testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge");
  const upload = page.locator("section").filter({ has: page.getByRole("heading", { name: "上传业务资料", exact: true }) });
  const input = upload.getByLabel("选择业务资料", { exact: true });
  const filename = `上传互斥核对-${randomUUID()}.txt`;
  const content = `独立资料上传的真实内容-${randomUUID()}\n只核对文件提交与回执，不执行助手或业务工具。`;
  await input.setInputFiles({ name: filename, mimeType: "text/plain", buffer: Buffer.from(content) });
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  const gate = await holdFirstUpload(page);
  const reply = page.waitForResponse(isUploadResponse);
  let result: SuccessfulUpload | null = null;
  try {
    await upload.getByRole("button", { name: "上传文档", exact: true }).focus();
    await page.keyboard.press("Enter");
    const request = await gate.received;
    expect(request.postDataBuffer()?.toString("utf8")).toContain(filename);
    expect(request.postDataBuffer()?.toString("utf8")).toContain(content);
    await expect(input).toBeDisabled();
    await expect(upload.getByRole("button", { name: "上传中…", exact: true })).toBeDisabled();
    await upload.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
    expect(writes).toEqual(["/api/knowledge/sources"]);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    gate.release();
    result = await readSuccessfulUpload(await reply);
    expect(result.deduped).toBe(false);
    expect(result.source.name).toBe(filename);
    expect(result.source.sizeBytes).toBe(Buffer.byteLength(content));
    await expect(input).toBeEnabled();
    await expect(upload.getByText("尚未选择文件", { exact: true })).toBeVisible();
    expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
    await expectNotice(upload, result);
    expect(writes).toEqual(["/api/knowledge/sources"]);
  } finally { await gate.close(); }
  if (!result) throw new Error("未取得实际上传成功回执，不能继续以占位资料核对详情");
  await expectSavedRecord(page, result);
  expect(writes).toEqual(["/api/knowledge/sources"]);
});

test("桌面合成选择变化不会让旧上传清空新文件，手动异名同内容上传接受真实旧名去重回执", async ({ page }, testInfo) => {
  test.setTimeout(180000); requireIsolatedUpload(testInfo);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/knowledge");
  const upload = page.locator("section").filter({ has: page.getByRole("heading", { name: "上传业务资料", exact: true }) });
  const input = upload.getByLabel("选择业务资料", { exact: true });
  const sample = randomUUID();
  const firstName = `原文件会话-${sample}.txt`;
  const nextName = `后来选择-${sample}.txt`;
  const buffer = Buffer.from(`同内容异名的真实资料-${sample}\n只核对已保存记录，不发送业务工具请求。`);
  await input.setInputFiles({ name: firstName, mimeType: "text/plain", buffer });
  const writes: string[] = [];
  let refreshes = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (!["GET", "HEAD"].includes(request.method())) writes.push(path);
    if (path === "/knowledge" && request.headers()["rsc"] === "1" && request.headers()["next-router-prefetch"] !== "1") refreshes += 1;
  });
  const gate = await holdFirstUpload(page);
  const firstReply = page.waitForResponse(isUploadResponse);
  let result: SuccessfulUpload | null = null;
  try {
    await upload.getByRole("button", { name: "上传文档", exact: true }).click();
    const firstRequest = await gate.received;
    expect(firstRequest.postDataBuffer()?.toString("utf8")).toContain(firstName);
    await expect(input).toBeDisabled();
    const refreshesBefore = refreshes;
    await input.evaluate((element: HTMLInputElement, replacement: { name: string; bytes: number[] }) => {
      const files = new DataTransfer();
      files.items.add(new File([new Uint8Array(replacement.bytes)], replacement.name, { type: "text/plain" }));
      element.files = files.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.form?.requestSubmit(); element.form?.requestSubmit();
    }, { name: nextName, bytes: Array.from(buffer) });
    await expect(upload.getByText(nextName, { exact: true })).toBeVisible();
    await expect(upload.getByRole("alert")).toContainText("后来选择的文件尚未提交");
    await expect(upload.getByRole("alert")).toContainText("不代表后台请求已取消");
    expect(writes).toEqual(["/api/knowledge/sources"]);
    gate.release();
    const first = await readSuccessfulUpload(await firstReply);
    expect(first.deduped).toBe(false); expect(first.source.name).toBe(firstName);
    await expect(input).toBeEnabled();
    expect(await input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe(nextName);
    await expect(upload.getByText(nextName, { exact: true })).toBeVisible();
    await expect(upload.getByText("尚未选择文件", { exact: true })).toHaveCount(0);
    await expect(upload.getByRole("status")).toHaveCount(0);
    await expect(upload.getByRole("alert")).toContainText("后来选择的文件尚未提交");
    expect(refreshes).toBe(refreshesBefore); expect(writes).toEqual(["/api/knowledge/sources"]);
    await requireReadyForOldNameDedup(page, first);
    expect(await input.evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe(nextName);
    const secondReply = page.waitForResponse(isUploadResponse);
    await upload.getByRole("button", { name: "上传文档", exact: true }).click();
    result = await readSuccessfulUpload(await secondReply);
    expect(result.deduped).toBe(true);
    expect(result.source.id).toBe(first.source.id);
    expect(result.source.name).toBe(firstName); expect(result.source.name).not.toBe(nextName);
    expect(result.source.sizeBytes).toBe(buffer.byteLength);
    await expect(input).toBeEnabled();
    await expect(upload.getByText("尚未选择文件", { exact: true })).toBeVisible();
    expect(await input.evaluate((element: HTMLInputElement) => element.files?.length)).toBe(0);
    await expectNotice(upload, result);
    await expect.poll(() => refreshes).toBeGreaterThan(refreshesBefore);
    expect(writes).toEqual(["/api/knowledge/sources", "/api/knowledge/sources"]);
  } finally { await gate.close(); }
  if (!result) throw new Error("未取得实际去重回执，不能把旧列表或未提交文件当作上传成功");
  await expectSavedRecord(page, result);
  expect(writes).toEqual(["/api/knowledge/sources", "/api/knowledge/sources"]);
});
