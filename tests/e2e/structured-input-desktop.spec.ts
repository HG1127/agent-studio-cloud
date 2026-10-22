import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { RunReportFile } from "../../src/contracts/run";
import { RunTaskStartInput } from "../../src/contracts/run-task";
import { VersionExportFile } from "../../src/contracts/version";
import type { AgentInputField } from "../../src/contracts/manifest";
import { runLauncherFieldLabel } from "../../src/features/agents/run-launcher-input";
import { webToolInputLabel } from "../../src/features/web-tools/web-tool-field-label";

function requireFixture(testInfo: TestInfo) {
  const base = testInfo.project.use.baseURL;
  const hostname = typeof base === "string" ? new URL(base).hostname : "";
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
    throw new Error("须由专用CI证明隔离数据库、演示模型与本机服务，不能只设置标记或回退生产环境");
  }
  const agent = RunTaskStartInput.shape.agentId.safeParse(process.env.STRUCTURED_INPUT_E2E_AGENT_ID);
  const version = RunTaskStartInput.shape.versionId.unwrap().safeParse(process.env.STRUCTURED_INPUT_E2E_VERSION_ID);
  if (!agent.success || !version.success) throw new Error("须由专用CI准备真实隔离助手和正式版本UUID，包含对象与列表业务输入；缺少夹具明确失败，不注入假来源或跳过");
  return { agentId: agent.data, versionId: version.data };
}

async function readSource(page: Page, fixture: ReturnType<typeof requireFixture>) {
  const response = await page.request.get(`/api/agents/${fixture.agentId}/versions/${fixture.versionId}/export`);
  expect(response.ok()).toBe(true);
  const saved = VersionExportFile.parse(await response.json());
  expect(saved.version.status).toBe("production");
  expect(saved.manifest.workflowSnapshot.rootAgent.id).toBe(fixture.agentId);
  if (saved.manifest.resourceSelection?.model?.mock !== true) throw new Error("真实冻结版本必须明确选择模拟模型，进程MODEL_MOCK标记不能代替已保存版本的模型证据");
  const safeTypes = new Set(["trigger", "end", "ai", "human", "condition", "rule"]);
  if (Object.values(saved.manifest.workflowSnapshot.nodes).some((node) => !safeTypes.has(node.type))) throw new Error("结构输入原生夹具只接受最小安全流程，不允许业务工具、协作、文件、外部事件或嵌套步骤");
  const fields = saved.manifest.inputContract.fields;
  const arrayIndex = fields.findIndex((field) => field.type === "array");
  const objectIndex = fields.findIndex((field) => field.type === "object");
  if (arrayIndex < 0 || objectIndex < 0) throw new Error("真实版本没有同时提供对象和列表，不能把普通文本表单或空目录算结构录入验收");
  if (new Set(fields.map((field) => field.name)).size !== fields.length) throw new Error("真实字段身份重复，无法安全核对结构导入归属");
  return { saved, fields, arrayIndex, objectIndex };
}

function label(field: AgentInputField, index: number, surface: "agent" | "web") {
  return surface === "agent" ? runLauncherFieldLabel(field, index) : webToolInputLabel(field, index);
}

async function fillFields(scope: Locator, fields: AgentInputField[], surface: "agent" | "web") {
  const expected: Record<string, unknown> = {};
  for (const [index, field] of fields.entries()) {
    const control = scope.getByLabel(`${label(field, index, surface)}（${field.required ? "必填" : "选填"}）`, { exact: true });
    const raw = field.type === "array" ? "[0,false]" : field.type === "object" ? '{"数量":0,"已核对":false,"未填写":null,"原文":"001"}' : field.type === "number" ? "0" : field.type === "boolean" ? "false" : "  隔离结构录入原文\n第二行不裁剪  ";
    if (field.type === "boolean") await control.selectOption(raw);
    else await control.fill(raw);
    expected[field.name] = field.type === "string" ? raw : JSON.parse(raw);
  }
  return expected;
}

async function editStructured(scope: Locator, source: Awaited<ReturnType<typeof readSource>>, expected: Record<string, unknown>, surface: "agent" | "web") {
  const arrayField = source.fields[source.arrayIndex];
  const arrayLabel = label(arrayField, source.arrayIndex, surface);
  const objectField = source.fields[source.objectIndex];
  const objectLabel = label(objectField, source.objectIndex, surface);
  const rows = Array.from({ length: 60 }, (_, index) => ({ 员工编号: String(index + 1).padStart(3, "0"), 标记: index === 0 ? "false" : "0" }));
  const text = "员工编号,标记\r\n" + rows.map((row) => `${row.员工编号},${row.标记}`).join("\r\n");
  const array = scope.getByRole("region", { name: `${arrayLabel}结构化录入`, exact: true });
  await array.getByRole("button", { name: "从表格或本地文件导入", exact: true }).click();
  await array.getByLabel(`粘贴${arrayLabel}资料`, { exact: true }).fill(text);
  await array.getByLabel(`${arrayLabel}资料格式`, { exact: true }).selectOption("csv");
  await array.getByRole("button", { name: "预览导入", exact: true }).click();
  await expect(array.getByLabel(`${arrayLabel}导入内容预览（数据格式）`)).toContainText("001");
  await expect(array.getByLabel(`${arrayLabel}导入内容预览（数据格式）`)).not.toContainText("060");
  await expect(scope.getByLabel(`${arrayLabel}（${arrayField.required ? "必填" : "选填"}）`, { exact: true })).toHaveValue("[0,false]");
  await array.getByRole("button", { name: "确认替换当前资料", exact: true }).click();
  expected[arrayField.name] = rows;
  expect(JSON.parse(await scope.getByLabel(`${arrayLabel}（${arrayField.required ? "必填" : "选填"}）`, { exact: true }).inputValue())).toEqual(rows);
  await array.getByRole("button", { name: "下一页记录", exact: true }).click();
  await expect(array.getByRole("table", { name: `${arrayLabel}当前记录` })).toContainText("060");
  const object = scope.getByRole("region", { name: `${objectLabel}结构化录入`, exact: true });
  await object.getByRole("button", { name: `编辑${objectLabel}第 1 条的已核对`, exact: true }).click();
  await object.getByLabel(`${objectLabel}本次编辑内容`, { exact: true }).selectOption("false");
  await object.getByRole("button", { name: "应用单元格编辑", exact: true }).click();
  await object.getByRole("button", { name: "添加业务字段", exact: true }).click();
  await object.getByLabel(`${objectLabel}新增业务字段名称`, { exact: true }).fill("业务备注");
  await object.getByLabel(`${objectLabel}本次编辑内容`, { exact: true }).fill("  原生核对\n保留完整内容  ");
  await object.getByRole("button", { name: "添加字段到原输入", exact: true }).click();
  expected[objectField.name] = { 数量: 0, 已核对: false, 未填写: null, 原文: "001", 业务备注: "  原生核对\n保留完整内容  " };
  expect(JSON.parse(await scope.getByLabel(`${objectLabel}（${objectField.required ? "必填" : "选填"}）`, { exact: true }).inputValue())).toEqual(expected[objectField.name]);
  await expect(scope.getByLabel("结构化填写状态")).toContainText("尚未提交任务或保存版本");
}

for (const surface of ["agent", "web"] as const) {
  test(`结构化输入桌面${surface === "agent" ? "助手" : "网页"}真实导入与编辑后，真实任务保留完整60条及原类型`, async ({ page }, testInfo) => {
    const fixture = requireFixture(testInfo);
    const source = await readSource(page, fixture);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(surface === "agent" ? `/agents/${fixture.agentId}` : `/web-tools?version=${fixture.versionId}`);
    const scope = surface === "agent" ? page.locator("#run") : page.getByRole("region", { name: "网页填写预览", exact: true });
    if (surface === "agent") {
      const current = page.locator("#versions").getByRole("listitem").filter({ has: page.getByText("当前版本", { exact: true }) });
      await expect(current).toHaveCount(1);
      await expect(current.getByRole("link", { name: "下载此版本", exact: true })).toHaveAttribute("href", `/api/agents/${fixture.agentId}/versions/${fixture.versionId}/export`);
      await expect(scope.getByText(`正式版本 V${source.saved.version.number}`, { exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("combobox", { name: "用于核对的助手版本", exact: true })).toHaveValue(fixture.versionId);
      await expect(page.getByRole("link", { name: "查看助手版本", exact: true })).toHaveAttribute("href", `/agents/${fixture.agentId}#versions`);
    }
    const expectedInput = await fillFields(scope, source.fields, surface);
    const writes: string[] = [];
    page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
    await editStructured(scope, source, expectedInput, surface);
    expect(writes).toEqual([]);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    if (surface === "agent") await scope.getByRole("button", { name: "开始试运行", exact: true }).click();
    else {
      await scope.getByRole("button", { name: "用这些填写试运行", exact: true }).click();
      await page.getByRole("dialog", { name: "确认创建真实试运行？" }).getByRole("button", { name: "确认并创建任务", exact: true }).click();
    }
    await page.waitForURL((url) => /^\/runs\/[0-9a-f-]{36}$/i.test(url.pathname), { timeout: 60000 });
    const response = await page.request.get("/api" + new URL(page.url()).pathname + "/export");
    expect(response.ok()).toBe(true);
    const report = RunReportFile.parse(await response.json());
    expect(report.run.agentId).toBe(fixture.agentId); expect(report.run.versionId).toBe(fixture.versionId);
    expect(report.run.sourceType).toBe("manual"); expect(report.run.input).toEqual(expectedInput);
    expect(writes).toHaveLength(1);
    await testInfo.attach("结构化真实输入与指定版本核对", { body: JSON.stringify({ sameAgent: report.run.agentId === fixture.agentId, sameVersion: report.run.versionId === fixture.versionId, completeRows: 60, preservedInput: JSON.stringify(report.run.input) === JSON.stringify(expectedInput) }), contentType: "application/json" });
  });
}
