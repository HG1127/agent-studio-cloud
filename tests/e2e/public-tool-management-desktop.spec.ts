import { isDeepStrictEqual } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import {
  PublicToolCallInput, PublicToolCallResult, PublicToolListResult, PublicToolPublishedVersion, PublicToolReadResult,
} from "../../src/contracts/public-agent-tool";
import { PublicToolKeyManagementResult } from "../../src/contracts/public-tool-key-management";
import { VersionExportFile } from "../../src/contracts/version";

test.use({ trace: "off", screenshot: "off", video: "off" });

async function enterCredential(page: Page, selector: string, value: string) {
  try {
    // Secret arguments must not appear in fill/assertion titles or recorded screenshots.
    await page.evaluate(({ selector, value }) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!input || input.disabled || !setter) throw new Error("临时凭据输入入口不可用");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, { selector, value });
  } catch { throw new Error("临时凭据输入失败，原始凭据不写入错误或附件"); }
}

async function secretRead(page: Page, path: string, credential: string) {
  return page.evaluate(async ({ path, credential }) => {
    try {
      const response = await fetch(path, { headers: { authorization: `Bearer ${credential}` }, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      return { ok: response.ok, status: response.status, value: await response.json() as unknown };
    } catch { return { ok: false, status: 0, value: null }; }
  }, { path, credential });
}

function observeLocalInventoryRequests(page: Page) {
  let count = 0;
  const observe = (request: import("@playwright/test").Request) => {
    const path = new URL(request.url()).pathname;
    if (!["GET", "HEAD"].includes(request.method()) || path === "/web-tools"
      || path === "/api/public-tools" || path.startsWith("/api/public-tools/")) count += 1;
  };
  page.on("request", observe);
  return { count: () => count, stop: () => { page.off("request", observe); } };
}

test("真实隔离桌面工具定义、固定发布、发放凭据、调用核对与刷新后撤销", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const base = testInfo.project.use.baseURL;
  const admin = process.env.PUBLIC_TOOL_E2E_ADMIN_CREDENTIAL;
  const agent = PublicToolPublishedVersion.shape.agentId.safeParse(process.env.PUBLIC_TOOL_E2E_AGENT_ID);
  const version = PublicToolPublishedVersion.shape.versionId.safeParse(process.env.PUBLIC_TOOL_E2E_VERSION_ID);
  if (typeof base !== "string" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname) || new URL(base).port === "3210"
    || process.env.PUBLIC_TOOL_E2E_ISOLATED !== "1" || process.env.PUBLIC_TOOL_E2E_SECRET_RECORDING_OFF !== "1"
    || process.env.PUBLIC_TOOL_E2E_REAL_CALL_READY !== "1" || !agent.success || !version.success
    || typeof admin !== "string" || !/^[A-Za-z0-9._~-]{32,256}$/.test(admin) || admin.startsWith("pat_")) {
    throw new Error("CI 须外部证明专用隔离数据库、非 3210 本机服务、关闭追踪截图录屏和秘密日志，再提供对应三个前提旗标及 PUBLIC_TOOL_E2E_ADMIN_CREDENTIAL、AGENT_ID、VERSION_ID、INPUT。需要实际可执行正式助手版本和额度；旗标不证明隔离或付费安全。缺条件不跳过，不使用生产或旧预览，不伪造动作回执。");
  }
  let input: PublicToolCallInput["input"];
  try { input = PublicToolCallInput.shape.input.parse(JSON.parse(process.env.PUBLIC_TOOL_E2E_INPUT ?? "")); }
  catch { throw new Error("须提供合法的真实业务调用输入，不输出原始夹具值"); }
  const rawInput = JSON.stringify(input);
  if (rawInput.includes(admin) || /\bpat_[a-f0-9]{64}\b/.test(rawInput)) throw new Error("真实业务夹具不能包含调用或管理凭据");
  const sourceResponse = await page.request.get(`/api/agents/${agent.data}/versions/${version.data}/export`);
  if (!sourceResponse.ok()) throw new Error("无法读取所选正式版本，不改用最新版本或虚构来源");
  const source = VersionExportFile.parse(await sourceResponse.json());
  if (source.version.status !== "production" || !source.manifest.outputContract?.fields.length
    || source.manifest.inputContract.fields.some((field) => ["object", "array"].includes(field.type))) {
    throw new Error("首批原生操作夹具须为真实正式版本、有效交付字段与文字/数字/是否输入；本原生规格不验证结构化输入，对应组件规格须另行执行，不能改用空输入或占位成果");
  }
  const errors: string[] = [];
  page.on("pageerror", () => errors.push("页面出现运行错误（原值不记录）"));
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/web-tools");
  const beforeResponse = await secretRead(page, "/api/public-tools", admin);
  if (!beforeResponse.ok) throw new Error("专用管理凭据未通过真实管理入口，不输出凭据或响应原值");
  const before = PublicToolListResult.parse(beforeResponse.value);
  if (!before.ok || before.truncated || before.tools.length >= 100) throw new Error("隔离环境工具列表或创建额度无法核对；不清理其他记录以通过测试");
  const management = page.getByRole("region", { name: "已发布工具管理", exact: true });
  await expect(management).toBeVisible();
  await enterCredential(page, 'input[aria-label="管理凭据"]', admin);
  const toolName = `网页工具链路核对 ${Date.now()} ${"T".repeat(150)}`;
  const keyName = `本次独立验收凭据 ${Date.now()} ${"K".repeat(150)}`;
  await management.getByRole("button", { name: "定义新工具", exact: true }).click();
  await management.getByRole("textbox", { name: "工具名称", exact: true }).fill(toolName);
  await management.getByRole("textbox", { name: "工具说明", exact: true }).fill("仅供专用隔离环境核对真实发布调用链路");
  await management.getByRole("button", { name: "保存工具定义", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "确认本次工具管理操作？", exact: true });
  await expect(creation).toContainText(toolName);
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  await creation.getByRole("button", { name: "确认执行管理操作", exact: true }).click();
  const selected = management.getByRole("region", { name: "所选工具操作", exact: true });
  await expect(selected).toContainText(toolName);
  await expect(selected.getByRole("combobox", { name: "发布到哪个正式版本", exact: true })).toHaveValue("");
  const definitionHandoff = management.getByRole("region", { name: "工具定义后的下一步", exact: true });
  await expect(definitionHandoff).toBeVisible();
  const handoffRequests = observeLocalInventoryRequests(page);
  try {
    await definitionHandoff.getByRole("button", { name: "继续选择正式版本", exact: true }).click();
    await expect(selected.getByRole("combobox", { name: "发布到哪个正式版本", exact: true })).toBeFocused();
    await expect(selected.getByRole("combobox", { name: "发布到哪个正式版本", exact: true })).toHaveValue("");
    await expect(selected.getByRole("button", { name: "确认发布版本", exact: true })).toBeDisabled();
    expect(handoffRequests.count()).toBe(0);
  } finally { handoffRequests.stop(); }
  await selected.getByRole("combobox", { name: "发布到哪个正式版本", exact: true }).selectOption(version.data);
  await selected.getByRole("button", { name: "确认发布版本", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "确认本次工具管理操作？", exact: true })).toContainText(`版本 ${source.version.number}`);
  await page.getByRole("button", { name: "确认执行管理操作", exact: true }).click();
  await expect(selected.getByRole("heading", { name: `${toolName} · 已开放`, exact: true })).toBeVisible();

  await selected.getByRole("textbox", { name: "凭据名称", exact: true }).fill(keyName);
  await selected.getByRole("button", { name: "发放调用凭据", exact: true }).click();
  await page.getByRole("button", { name: "确认执行管理操作", exact: true }).click();
  const once = selected.getByRole("region", { name: "一次性调用凭据", exact: true });
  await expect(once).toBeVisible();
  const token = await once.getByLabel("一次性调用凭据明文", { exact: true }).inputValue();
  if (!/^pat_[a-f0-9]{64}$/.test(token)) throw new Error("一次性凭据回执格式无法核对，不输出原值");
  const afterCreateResponse = await secretRead(page, "/api/public-tools", admin);
  if (!afterCreateResponse.ok) throw new Error("无法只读核对已创建工具");
  const afterCreate = PublicToolListResult.parse(afterCreateResponse.value);
  if (!afterCreate.ok) throw new Error("管理清单核对失败");
  const actualTool = afterCreate.tools.find((tool) => tool.name === toolName);
  if (!actualTool || actualTool.status !== "enabled" || actualTool.publication?.agentId !== agent.data || actualTool.publication.versionId !== version.data) throw new Error("真实发布绑定不一致，不接受客户端提示代替后端状态");
  await once.getByRole("button", { name: "清除凭据明文", exact: true }).click();
  await expect(once).toHaveCount(0);
  const callableResponse = await secretRead(page, `/api/public-tools/${actualTool.toolId}`, token);
  if (!callableResponse.ok) throw new Error("调用凭据无法只读核对真实工具");
  const callable = PublicToolReadResult.parse(callableResponse.value);
  if (!callable.ok || callable.tool.publication?.publicationId !== actualTool.publication.publicationId) throw new Error("真实调用凭据或发布绑定无法核对");
  await enterCredential(page, 'section[aria-label="真实工具调用"] input[type="password"]', token);
  await selected.getByRole("button", { name: "核对调用字段", exact: true }).click();
  const form = selected.getByRole("form", { name: "工具调用填写", exact: true });
  await expect(form).toBeVisible();
  for (const [index, field] of callable.tool.publication!.inputContract.fields.entries()) {
    const label = (field.label?.trim() || `业务信息 ${index + 1}`) + (field.required ? "（必填）" : "（选填）");
    const value = input[field.name];
    if (value === undefined) { if (field.required) throw new Error("真实夹具缺少必填业务资料"); continue; }
    if (field.type === "boolean") await form.getByRole("combobox", { name: label, exact: true }).selectOption(value === true ? "true" : value === false ? "false" : "");
    else await form.getByLabel(label, { exact: true }).fill(String(value));
  }
  await form.getByRole("button", { name: "确认真实调用", exact: true }).click();
  await page.getByRole("dialog", { name: "确认执行真实工具调用？", exact: true }).getByRole("button", { name: "确认执行真实调用", exact: true }).click();
  const receiptView = selected.getByRole("region", { name: "已读取调用回执", exact: true });
  await expect(receiptView).toBeVisible();
  await expect(receiptView).toContainText("系统没有确认已经对外发送或交付");
  const requestText = await selected.getByRole("region", { name: "本次调用核对", exact: true }).locator("pre").textContent();
  let request: PublicToolCallInput;
  try { request = PublicToolCallInput.parse(JSON.parse(requestText ?? "")); } catch { throw new Error("客户端没有保留可核对的原调用请求"); }
  if (!isDeepStrictEqual(request.input, input)) throw new Error("原调用完整输入与提供的业务夹具不一致，不输出原始夹具或请求内容");
  let finalCall: PublicToolCallResult | null = null;
  for (let index = 0; index < 60; index++) {
    await selected.getByRole("button", { name: "只读核对原调用结果", exact: true }).click();
    const response = await secretRead(page, `/api/public-tools/${actualTool.toolId}/calls/${request.requestId}`, token);
    if (!response.ok) throw new Error("原请求只读回执不可访问，不改用其他请求");
    finalCall = PublicToolCallResult.parse(response.value);
    if (!finalCall.ok) throw new Error("原调用回执核对失败，不输出原始响应");
    if (["completed", "failed", "cancelled"].includes(finalCall.call.state)) break;
    await page.waitForTimeout(1000);
  }
  if (!finalCall?.ok || finalCall.call.state !== "completed" || !finalCall.call.resultAvailable || finalCall.call.deliveryConfirmed !== false
    || finalCall.call.publicationId !== actualTool.publication.publicationId || finalCall.call.version !== source.version.number) {
    throw new Error("真实调用未得到同一发布绑定的可核对成功成果；收到请求、失败和等待不算完成");
  }
  await selected.getByRole("button", { name: "只读核对原调用结果", exact: true }).click();
  await expect(receiptView.getByRole("heading", { name: `已完成 · 实际版本 ${source.version.number}`, exact: true })).toBeVisible();
  await management.getByRole("button", { name: "读取工具清单", exact: true }).click();
  const inventory = management.getByRole("region", { name: "已读取工具清单", exact: true });
  const inventorySearch = inventory.getByRole("search", { name: "工具清单查找", exact: true });
  const toolSearch = inventorySearch.getByRole("searchbox", { name: "搜索工具或关联助手", exact: true });
  const toolStates = inventorySearch.getByRole("group", { name: "工具开放状态", exact: true });
  const currentToolCard = inventory.getByRole("button", { name: `管理${toolName}`, exact: true });
  await expect(currentToolCard).toBeVisible();
  const publishedOption = await selected.getByRole("combobox", { name: "发布到哪个正式版本", exact: true }).locator(`option[value="${version.data}"]`).textContent();
  const optionSuffix = ` · 版本 ${source.version.number}`;
  const selectedAgentName = publishedOption?.endsWith(optionSuffix) ? publishedOption.slice(0, -optionSuffix.length).trim() : "";
  if (!selectedAgentName || selectedAgentName === "已读取助手" || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(selectedAgentName)
    || selectedAgentName.includes(admin) || /\bpat_[a-f0-9]{64}\b/.test(selectedAgentName)) {
    throw new Error("当前正式版本的助手名称无法安全核对，不以回退名称或内部编号完成查找验收");
  }
  const retainedCallRequests = observeLocalInventoryRequests(page);
  try {
    await toolSearch.fill(toolName);
    await expect(currentToolCard).toBeVisible();
    await toolStates.getByRole("button", { name: "未开放工具", exact: true }).click();
    await expect(currentToolCard).toHaveCount(0);
    await expect(inventory).toContainText("下方仍保留同一工具的填写与原请求，不会自动改选");
    await expect(selected.getByRole("heading", { name: `${toolName} · 已开放`, exact: true })).toBeVisible();
    await expect(selected.getByRole("textbox", { name: "凭据名称", exact: true })).toHaveValue(keyName);
    if (await selected.getByRole("region", { name: "本次调用核对", exact: true }).locator("pre").textContent() !== requestText) {
      throw new Error("本地工具筛选改变了原调用请求，不输出原请求或业务填写");
    }
    await expect(receiptView.getByRole("heading", { name: `已完成 · 实际版本 ${source.version.number}`, exact: true })).toBeVisible();
    await inventorySearch.getByRole("button", { name: "清除工具筛选", exact: true }).click();
    await expect(toolSearch).toBeFocused();
    await expect(toolSearch).toBeEmpty();
    await expect(toolStates.getByRole("button", { name: "全部工具", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(currentToolCard).toBeVisible();
    if (await selected.getByRole("region", { name: "本次调用核对", exact: true }).locator("pre").textContent() !== requestText) {
      throw new Error("清除工具筛选改变了原调用请求，不输出原请求或业务填写");
    }
    expect(retainedCallRequests.count()).toBe(0);
  } finally { retainedCallRequests.stop(); }
  await selected.getByRole("button", { name: "结束本页核对", exact: true }).click();
  await page.reload();
  await expect(management.getByLabel("管理凭据", { exact: true })).toBeEmpty();
  await expect(management.getByRole("region", { name: "一次性调用凭据", exact: true })).toHaveCount(0);
  await enterCredential(page, 'input[aria-label="管理凭据"]', admin);
  await management.getByRole("button", { name: "读取工具清单", exact: true }).click();
  await management.getByRole("button", { name: `管理${toolName}`, exact: true }).click();
  await selected.getByRole("button", { name: "刷新凭据清单", exact: true }).click();
  await expect(selected.getByRole("button", { name: `撤销${keyName}`, exact: true })).toBeVisible();
  await selected.getByRole("button", { name: `撤销${keyName}`, exact: true }).click();
  await page.getByRole("button", { name: "确认执行管理操作", exact: true }).click();
  await selected.getByRole("button", { name: "刷新凭据清单", exact: true }).click();
  await expect(selected.getByRole("button", { name: `撤销${keyName}`, exact: true })).toBeDisabled();
  const metadataResponse = await secretRead(page, `/api/public-tools/${actualTool.toolId}/keys`, admin);
  if (!metadataResponse.ok) throw new Error("撤销后管理元数据无法核对");
  const metadata = PublicToolKeyManagementResult.parse(metadataResponse.value);
  if (!metadata.ok || !metadata.keys.some((key) => key.name === keyName && key.revokedAt !== null)) throw new Error("真实凭据元数据没有确认撤销");
  const denied = await secretRead(page, `/api/public-tools/${actualTool.toolId}/calls/${request.requestId}`, token);
  expect(denied.status).toBe(401);
  const draftKeyName = `只填写不发放的凭据名称 ${Date.now()}`;
  await selected.getByRole("textbox", { name: "凭据名称", exact: true }).fill(draftKeyName);
  await expect(currentToolCard).toBeVisible();
  const filterRequests = observeLocalInventoryRequests(page);
  try {
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await toolSearch.focus();
      await expect(toolSearch).toBeFocused();
      await toolSearch.fill(`  ${toolName.toLocaleLowerCase()}  `);
      await expect(currentToolCard).toBeVisible();
      await expect(inventory.getByRole("button", { name: /^管理/ })).toHaveCount(1);
      await toolSearch.fill("真实发布调用链路");
      await expect(currentToolCard).toBeVisible();
      await expect(currentToolCard.locator("..")).toContainText(`关联助手（当前名称）：${selectedAgentName}`);
      await toolSearch.fill(selectedAgentName.slice(0, 200));
      await expect(currentToolCard).toBeVisible();
      await expect(currentToolCard.locator("..")).toContainText(`关联助手（当前名称）：${selectedAgentName}`);
      const stateCases = [
        { label: "全部工具", showsSelected: true },
        { label: "未开放工具", showsSelected: false },
        { label: "已开放工具", showsSelected: true },
        { label: "已停用工具", showsSelected: false },
      ];
      for (const stateCase of stateCases) {
        const control = toolStates.getByRole("button", { name: stateCase.label, exact: true });
        await control.focus();
        await expect(control).toBeFocused();
        await page.keyboard.press(stateCase.label === "已停用工具" ? "Space" : "Enter");
        for (const other of stateCases) {
          await expect(toolStates.getByRole("button", { name: other.label, exact: true })).toHaveAttribute("aria-pressed", String(other.label === stateCase.label));
        }
        if (stateCase.showsSelected) await expect(currentToolCard).toBeVisible();
        else {
          await expect(currentToolCard).toHaveCount(0);
          await expect(inventory).toContainText("下方仍保留同一工具的填写与原请求，不会自动改选");
        }
        await expect(selected.getByRole("heading", { name: `${toolName} · 已开放`, exact: true })).toBeVisible();
        await expect(selected.getByRole("textbox", { name: "凭据名称", exact: true })).toHaveValue(draftKeyName);
        await expect(selected.getByRole("button", { name: `撤销${keyName}`, exact: true })).toBeDisabled();
      }
      await toolStates.getByRole("button", { name: "全部工具", exact: true }).click();
      await toolSearch.fill(`清单中未使用的查找条件 ${Date.now()} ${"Q".repeat(40)}`);
      await expect(inventory.getByRole("heading", { name: "已读取范围内没有匹配的工具", exact: true })).toBeVisible();
      await expect(inventory.getByRole("button", { name: /^管理/ })).toHaveCount(0);
      await expect(inventorySearch).toContainText("当前筛选显示 0 项");
      await expect(inventory).toContainText("不是持续更新的总数");
      const clearFilters = inventorySearch.getByRole("button", { name: "清除工具筛选", exact: true });
      await clearFilters.focus();
      await expect(clearFilters).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(toolSearch).toBeFocused();
      await expect(toolSearch).toBeEmpty();
      await expect(toolStates.getByRole("button", { name: "全部工具", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(currentToolCard).toBeVisible();
      await expect(inventory.getByRole("heading", { name: "已读取范围内没有匹配的工具", exact: true })).toHaveCount(0);
      await expect(selected.getByRole("heading", { name: `${toolName} · 已开放`, exact: true })).toBeVisible();
      await expect(selected.getByRole("textbox", { name: "凭据名称", exact: true })).toHaveValue(draftKeyName);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(filterRequests.count()).toBe(0);
  } finally { filterRequests.stop(); }
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  expect(errors).toEqual([]);
  await testInfo.attach("真实公开工具链路范围", { body: JSON.stringify({ toolId: actualTool.toolId, requestId: request.requestId, fixtureVersionId: version.data, completed: true, revoked: true, traceScreenshotVideoDisabledInSpec: true, secretsAttached: false, isolationVerifiedByThisSpec: false, thirdPartyEmbeddingVerified: false, modelQualityOrExternalDeliveryVerified: false }, null, 2), contentType: "application/json" });
});
