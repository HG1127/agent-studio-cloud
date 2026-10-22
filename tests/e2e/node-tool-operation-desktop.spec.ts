import { expect, test } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { ToolRegistryOption } from "../../src/contracts/tool-registry";
import { nodeToolOperationWorkflow } from "../fixtures/node-tool-operation-workflow";

test("桌面工具防重使用实际登记，组内应用、真实保存、刷新与明确清除", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/connections");
  const definitions = page.getByRole("region", { name: /的完整登记定义$/ });
  await expect(definitions.first()).toBeVisible();
  let tool: ToolRegistryOption | undefined;
  for (let index = 0; index < await definitions.count(); index += 1) {
    const region = definitions.nth(index);
    await region.getByText("开发者完整登记原定义（只读）", { exact: true }).click();
    const parsed = ToolRegistryOption.parse(JSON.parse(await region.getByRole("textbox").inputValue()));
    if (parsed.businessIdempotency === true && parsed.businessIdempotencyRetentionMs) { tool = parsed; break; }
  }
  expect(tool, "隔离验收环境必须有实际已登记防重能力的工具，不能用空状态或前端假登记替代").toBeDefined();
  const actualTool = tool!;
  const name = "工具防重核对-" + Date.now();
  const definition = AgentExportFile.parse({ format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(), agent: { name, description: "只验收草稿配置，不发起业务工具调用", intentText: "核对真实已登记业务工具的防重配置、所属步骤与原保存回执，不执行业务操作" }, workflow: nodeToolOperationWorkflow(actualTool, name) });
  await page.goto("/agents/new");
  await page.getByLabel("选择助手定义文件").setInputFiles({ name: "tool-operation.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  const agentPath = new URL(page.url()).pathname;
  const readSaved = async () => { const response = await page.request.get("/api" + agentPath + "/export"); expect(response.ok()).toBe(true); return AgentExportFile.parse(await response.json()); };
  const initial = await readSaved();
  const writes: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  const locate = page.getByRole("combobox", { name: "定位流程步骤", exact: true });
  const open = async (id: string, label: string) => {
    await locate.selectOption(id);
    await page.getByLabel(label + "输入与结果约定", { exact: true }).click();
    return page.getByRole("region", { name: label + "字段约定", exact: true });
  };
  const fixed = async (id: string, label: string, value: string) => {
    const panel = await open(id, label);
    await panel.getByLabel("设置业务操作防重", { exact: true }).check();
    await panel.getByLabel("防重范围", { exact: true }).selectOption("registered");
    await panel.getByLabel("业务标识来源", { exact: true }).selectOption("literal");
    await panel.getByLabel("固定值类型", { exact: true }).selectOption("number");
    await panel.getByLabel("固定业务标识", { exact: true }).fill(value);
    return panel;
  };
  let top = await fixed("top", "当前步骤", "0");
  await expect(page.getByLabel("未应用配置提醒")).toContainText("1 处");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await locate.selectOption("prepare"); top = await open("top", "当前步骤");
  await expect(top.getByLabel("固定业务标识", { exact: true })).toHaveValue("0");
  await top.getByRole("button", { name: "应用到当前草稿", exact: true }).click();
  const group = await fixed("group", "步骤组步骤 2", "0");
  await group.getByRole("button", { name: "应用到当前草稿", exact: true }).click();
  const left = await fixed("parallel", "并行工作 1 步骤 1", "12");
  await left.getByRole("button", { name: "应用到当前草稿", exact: true }).click();
  expect(writes).toEqual([]);
  expect((await readSaved()).workflow).toEqual(initial.workflow);
  await expect(page.getByLabel("未应用配置提醒")).toHaveCount(0);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^草稿已保存$/ })).toBeVisible();
  const saved = await readSaved();
  const zero = { scope: actualTool.scope, key: { kind: "literal", value: 0 } }, twelve = { scope: actualTool.scope, key: { kind: "literal", value: 12 } };
  const expected = { ...initial.workflow, nodes: { ...initial.workflow.nodes,
    top: { ...initial.workflow.nodes.top, toolOperation: zero },
    group: { ...initial.workflow.nodes.group, subflow: { ...initial.workflow.nodes.group.subflow!, steps: initial.workflow.nodes.group.subflow!.steps.map((step, index) => index === 1 ? { ...step, toolOperation: zero } : step) } },
    parallel: { ...initial.workflow.nodes.parallel, parallel: { ...initial.workflow.nodes.parallel.parallel!, branches: initial.workflow.nodes.parallel.parallel!.branches.map((branch) => branch.id === "left" ? { ...branch, steps: branch.steps.map((step) => ({ ...step, toolOperation: twelve })) } : branch) } },
  } };
  expect(saved.workflow).toEqual(expected); expect(writes).toEqual([agentPath]);
  await page.reload(); top = await open("top", "当前步骤");
  await expect(top.getByLabel("设置业务操作防重", { exact: true })).toBeChecked();
  await expect(top.getByRole("button", { name: "编辑防重规则", exact: true })).toBeVisible();
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await top.getByLabel("设置业务操作防重", { exact: true }).uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled(); expect(writes).toEqual([agentPath]);
  await top.getByLabel("设置业务操作防重", { exact: true }).uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "确认清除防重规则", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^草稿已保存$/ })).toBeVisible();
  const cleared = await readSaved(), clearedTop = { ...saved.workflow.nodes.top }; delete clearedTop.toolOperation;
  expect(cleared.workflow).toEqual({ ...saved.workflow, nodes: { ...saved.workflow.nodes, top: clearedTop } });
  expect(writes).toEqual([agentPath, agentPath]); expect(errors).toEqual([]);
  await testInfo.attach("真实登记防重保存边界", { body: JSON.stringify({ agentPath, registeredTool: actualTool.name, applied: { top: zero, group: zero, left: twelve }, writes, sourceIds: cleared.workflow.nodes.group.subflow!.steps.map((step) => step.id), saved: saved.workflow, cleared: cleared.workflow, errors }, null, 2), contentType: "application/json" });
});
