import { expect, test, type Locator, type Page } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { qualityGateRulesDraft } from "../fixtures/quality-gate-rules";

const rule = { type: "object", properties: { amount: { type: "number", minimum: 0 }, approved: { const: false } }, required: ["amount"] };
const replacement = { ...rule, additionalProperties: false };

async function prepare(page: Page) {
  const definition = AgentExportFile.parse({
    format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(),
    agent: { name: "验收结构规则核对-" + Date.now(), description: "核对样例规则保存", intentText: "核对结果结构规则的保存和编辑冲突边界" },
    workflow: qualityGateRulesDraft(),
  });
  await page.goto("/agents/new");
  await page.getByLabel("选择助手定义文件").setInputFiles({
    name: "evaluation-schema.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)),
  });
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname;
}
async function createSample(evaluation: Locator, name: string) {
  await evaluation.getByLabel("样例名称", { exact: true }).fill(name);
  await evaluation.getByLabel("运行输入", { exact: true }).fill(JSON.stringify({ input: "原始测试输入", amount: 0, approved: false }));
  const editor = evaluation.getByRole("region", { name: "验收结果结构规则", exact: true });
  await editor.getByRole("button", { name: "编辑结果结构规则", exact: true }).click();
  await expect(editor.getByLabel("结果结构规则（开发者格式）")).toHaveValue("");
  await editor.getByLabel("结果结构规则（开发者格式）").fill(JSON.stringify(rule));
  await evaluation.getByRole("button", { name: "添加样例", exact: true }).click();
  await expect(evaluation.getByRole("status").filter({ hasText: "验收样例已保存" })).toBeVisible();
  return evaluation.getByRole("listitem", { name: "验收样例：" + name, exact: true });
}
async function savedRule(row: Locator) {
  const contents = row.locator("details").filter({ has: row.page().getByText("查看样例内容", { exact: true }) }).first();
  if (!(await contents.evaluate((element: HTMLDetailsElement) => element.open))) await contents.locator("summary").first().click();
  const source = row.getByRole("region", { name: "已保存的结果结构规则", exact: true });
  const data = source.getByText("查看已保存规则（开发者数据）", { exact: true });
  if (await data.count()) {
    const details = source.locator("details");
    if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await data.click();
    return JSON.parse((await source.locator("pre").textContent())!);
  }
  return null;
}
async function editRule(evaluation: Locator, row: Locator, value: unknown) {
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = evaluation.getByRole("region", { name: "验收结果结构规则", exact: true });
  await editor.getByRole("button", { name: "编辑结果结构规则", exact: true }).click();
  await editor.getByLabel("结果结构规则（开发者格式）").fill(JSON.stringify(value));
  return editor;
}

test("桌面真实样例结构规则创建、保留、取消及明确清除", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const agentPath = await prepare(page);
  const evaluation = page.locator("#evaluation"), writes: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  const name = "仅结构检查-" + Date.now();
  let row = await createSample(evaluation, name);
  await expect(row).toContainText("检查结果结构");
  await expect(row).not.toContainText("只检查流程是否成功完成");
  expect(await savedRule(row)).toEqual(rule);
  expect(writes).toEqual([agentPath]);
  await page.reload();
  row = evaluation.getByRole("listitem", { name: "验收样例：" + name, exact: true });
  expect(await savedRule(row)).toEqual(rule);

  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const renamed = name + "-保留原规则";
  await evaluation.getByLabel("样例名称", { exact: true }).fill(renamed);
  await evaluation.getByLabel("运行输入", { exact: true }).fill('{"input":"保留原规则的新输入","amount":0,"approved":false}');
  await evaluation.getByRole("button", { name: "保存修改", exact: true }).click();
  row = evaluation.getByRole("listitem", { name: "验收样例：" + renamed, exact: true });
  await expect(row).toBeVisible();
  expect(await savedRule(row)).toEqual(rule);

  let editor = await editRule(evaluation, row, replacement);
  await expect(editor.getByText(/本页规则填写尚未保存/)).toContainText("不代表规则有效或验收通过");
  await editor.getByRole("button", { name: "取消规则填写", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "返回", exact: true }).click();
  await expect(editor.getByLabel("结果结构规则（开发者格式）")).toHaveValue(JSON.stringify(replacement));
  await evaluation.getByLabel("结果应包含", { exact: true }).fill("继续保留的字段检查");
  await editor.getByRole("button", { name: "取消规则填写", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认取消规则填写", exact: true }).click();
  await expect(evaluation.getByLabel("结果应包含", { exact: true })).toHaveValue("继续保留的字段检查");
  await evaluation.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(evaluation.getByLabel("样例名称")).toHaveValue("");
  expect(await savedRule(row)).toEqual(rule);
  await expect(row).toContainText("继续保留的字段检查");

  editor = await editRule(evaluation, row, replacement);
  await evaluation.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(evaluation.getByLabel("样例名称")).toHaveValue("");
  expect(await savedRule(row)).toEqual(replacement);
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  editor = evaluation.getByRole("region", { name: "验收结果结构规则", exact: true });
  const writesBeforeClear = writes.length;
  await editor.getByRole("button", { name: "明确清除结构规则", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "返回", exact: true }).click();
  expect(writes).toHaveLength(writesBeforeClear);
  expect(await savedRule(row)).toEqual(replacement);
  await editor.getByRole("button", { name: "明确清除结构规则", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "确认清除结构规则", exact: true }).click();
  await expect(editor.getByRole("status")).toContainText("本次保存将明确清除");
  expect(writes).toHaveLength(writesBeforeClear);
  await evaluation.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(evaluation.getByLabel("样例名称")).toHaveValue("");
  await page.reload();
  row = evaluation.getByRole("listitem", { name: "验收样例：" + renamed, exact: true });
  expect(await savedRule(row)).toBeNull();
  await expect(row.getByRole("region", { name: "已保存的结果结构规则" })).toContainText("已明确未设置");
  await expect(row).toContainText("继续保留的字段检查");

  await editRule(evaluation, row, { type: "object", oneOf: [] });
  await evaluation.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(evaluation.getByRole("alert")).toContainText("暂不支持");
  await expect(evaluation.getByLabel("结果结构规则（开发者格式）")).toHaveValue('{"type":"object","oneOf":[]}');
  await expect(evaluation.getByLabel("结果应包含")).toHaveValue("继续保留的字段检查");
  expect(await savedRule(row)).toBeNull();
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
  await testInfo.attach("结构规则真实保存记录", { body: JSON.stringify({ agentPath, writes, rule, replacement, errors, businessExecution: false, checksExecutedByAuthor: false }, null, 2), contentType: "application/json" });
});

test("桌面两页真实保存冲突保留全部规则填写", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const agentPath = await prepare(page);
  const evaluation = page.locator("#evaluation"), name = "结构冲突-" + Date.now();
  const row = await createSample(evaluation, name);
  await editRule(evaluation, row, replacement);
  await evaluation.getByLabel("样例名称").fill(name + "-本页填写");
  await evaluation.getByLabel("运行输入", { exact: true }).fill('{"input":"本页未保存输入"}');
  await evaluation.getByLabel("结果应包含").fill("本页未保存字段检查");

  const other = await context.newPage();
  try {
    await other.goto(agentPath + "#evaluation");
    const otherEvaluation = other.locator("#evaluation");
    const otherRow = otherEvaluation.getByRole("listitem", { name: "验收样例：" + name, exact: true });
    const otherRule = { type: "object", required: ["other"] };
    await editRule(otherEvaluation, otherRow, otherRule);
    await otherEvaluation.getByLabel("样例名称").fill(name + "-其他页保存");
    await otherEvaluation.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(otherEvaluation.getByLabel("样例名称")).toHaveValue("");
    const actual = otherEvaluation.getByRole("listitem", { name: "验收样例：" + name + "-其他页保存", exact: true });
    expect(await savedRule(actual)).toEqual(otherRule);
    await evaluation.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(evaluation.getByRole("alert")).toContainText("已在其他页面发生变化");
    await expect(evaluation.getByLabel("样例名称")).toHaveValue(name + "-本页填写");
    await expect(evaluation.getByLabel("运行输入", { exact: true })).toHaveValue('{"input":"本页未保存输入"}');
    await expect(evaluation.getByLabel("结果应包含")).toHaveValue("本页未保存字段检查");
    await expect(evaluation.getByLabel("结果结构规则（开发者格式）")).toHaveValue(JSON.stringify(replacement));
    await other.reload();
    expect(await savedRule(actual)).toEqual(otherRule);
    await testInfo.attach("结构规则实际版本冲突", { body: JSON.stringify({ agentPath, localRule: replacement, savedRule: otherRule, conflictPreserved: true, businessExecution: false, checksExecutedByAuthor: false }, null, 2), contentType: "application/json" });
  } finally { await other.close(); }
});
