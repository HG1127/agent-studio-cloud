import { expect, test, type Locator, type Page } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { ToolRegistryOption } from "../../src/contracts/tool-registry";
import { ToolSpec, type WorkflowDraft } from "../../src/contracts/workflow";
import { workflowToolBindingDesktopDraft } from "../fixtures/workflow-tool-binding-desktop";

test.beforeEach(async ({ baseURL }) => {
  expect(process.env.LOCAL_ACCEPTANCE_REPORTS, "写入规格只交由确认隔离分支与自有服务的验收控制器运行，不能直接复用用户预览").toBeTruthy();
  expect(process.env.PLAYWRIGHT_REUSE_SERVER).not.toBe("1");
  expect(baseURL).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/);
});

async function readActualTools(page: Page): Promise<[ToolRegistryOption, ToolRegistryOption]> {
  await page.goto("/connections");
  const catalog = page.getByRole("region", { name: "业务工具目录", exact: true });
  await expect(catalog).toBeVisible();
  const rows = catalog.locator("li[id^='business-tool-']");
  const count = await rows.count();
  expect(count, "隔离验收环境须登记至少两项实际工具，缺失不跳过或以演示工具替代").toBeGreaterThanOrEqual(2);
  const tools: ToolRegistryOption[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index), name = await row.getByRole("heading", { level: 3 }).innerText();
    await row.getByText("查看" + name + "的详情", { exact: true }).click();
    const details = row.getByRole("region", { name: name + "的完整登记定义", exact: true });
    await details.getByText("开发者完整登记原定义（只读）", { exact: true }).click();
    const parsed = ToolRegistryOption.parse(JSON.parse(await details.getByRole("textbox", { name: name + "的登记原定义", exact: true }).inputValue()));
    expect(parsed.name).toBe(name);
    expect(["http-json", "mcp-streamable-http"]).toContain(parsed.protocol ?? "http-json");
    tools.push(parsed);
  }
  expect(new Set(tools.map((tool) => tool.id)).size).toBe(tools.length);
  const uniqueNames = tools.filter((tool) => tools.filter((other) => other.name === tool.name).length === 1);
  expect(uniqueNames.length, "本规格需两项可用名称单独定位的真实登记，缺失为测试配置失败").toBeGreaterThanOrEqual(2);
  const [first, second] = uniqueNames;
  if (!first || !second) throw new Error("隔离验收登记不完整，不能用假工具替代");
  return [first, second];
}

async function importDraft(page: Page, tool: ToolRegistryOption, name: string) {
  const definition = AgentExportFile.parse({ format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(), agent: { name,
    description: "仅验收隔离草稿的工具绑定、保存与刷新，不调用工具或创建业务运行", intentText: "明确核对工具使用位置、条件默认路径、循环完成路径与原配置保留" }, workflow: workflowToolBindingDesktopDraft(tool, name) });
  await page.goto("/agents/new");
  await page.getByLabel("选择助手定义文件", { exact: true }).setInputFiles({ name: "tool-binding-desktop.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/);
  const agentPath = new URL(page.url()).pathname;
  const readSaved = async () => {
    const response = await page.request.get("/api" + agentPath + "/export");
    expect(response.ok()).toBe(true);
    return AgentExportFile.parse(await response.json());
  };
  const initial = await readSaved();
  expect(initial.workflow.rootAgent.id.toLowerCase()).toBe(agentPath.slice("/agents/".length).toLowerCase());
  expect(initial.workflow.nodes.business.tool?.registryToolId).toBe(tool.id);
  await expect(page.getByLabel("流程编辑画布", { exact: true })).toBeVisible();
  return { agentPath, readSaved, initial };
}

function traceRequests(page: Page, agentPath: string) {
  const writes: string[] = [], forbidden: string[] = [], errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      writes.push(path);
      if (path !== agentPath || !request.headers()["next-action"]) forbidden.push(path);
    }
    if (/^\/api\/(?:tools\/.*(?:call|execute|invoke)|mcp\/.*(?:check|discover))/.test(path)) forbidden.push(path);
  });
  return { writes, forbidden, errors };
}

async function openWizard(page: Page, tools: ToolRegistryOption[]) {
  await page.getByRole("button", { name: "应用工具到流程", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "应用工具到流程", exact: true });
  await expect(wizard).toBeVisible();
  for (const tool of tools) await wizard.getByRole("checkbox", { name: "选择工具 " + tool.name, exact: true }).check();
  await wizard.getByRole("button", { name: "安排使用位置", exact: true }).click();
  return wizard;
}
async function arrange(wizard: Locator, row: number, mode: "existing" | "after", target: string) {
  await wizard.getByRole("combobox", { name: `工具 ${row} 使用方式`, exact: true }).selectOption(mode);
  await wizard.getByRole("combobox", { name: `工具 ${row} 使用位置`, exact: true }).selectOption(target);
}
async function reviewAndApply(wizard: Locator) {
  await wizard.getByRole("button", { name: "核对变更方案", exact: true }).click();
  await expect(wizard.getByRole("button", { name: "应用到本页草稿", exact: true })).toBeDisabled();
  await wizard.getByRole("checkbox", { name: "确认已核对工具使用方案", exact: true }).check();
  await wizard.getByRole("button", { name: "应用到本页草稿", exact: true }).click();
}
async function desktopLayout(page: Page, wizard?: Locator) {
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (wizard) {
      const bounds = await wizard.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      expect(await wizard.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
  }
}

test("桌面向导从真实登记到真实草稿保存，保留原配置、默认路径与刷新结果", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const [originalTool, replacement] = await readActualTools(page);
  const { agentPath, readSaved, initial } = await importDraft(page, originalTool, "工具绑定实际保存核对-" + Date.now());
  const observed = traceRequests(page, agentPath);
  const wizard = await openWizard(page, [replacement, originalTool]);
  await expect(wizard.getByRole("combobox", { name: "工具 1 使用位置", exact: true })).toHaveValue("");
  await arrange(wizard, 1, "existing", "business");
  await arrange(wizard, 2, "after", "decision");
  await wizard.getByRole("button", { name: "核对变更方案", exact: true }).click();
  await expect(wizard).toContainText("原输入映射、业务防重配置会保留");
  const definitions = wizard.getByText("核对输入、结果字段与执行边界", { exact: true });
  await definitions.first().click();
  await expect(wizard.getByRole("region", { name: "输入字段约定", exact: true }).first()).toBeVisible();
  await expect(wizard.getByRole("region", { name: "结果字段约定", exact: true }).first()).toBeVisible();
  await desktopLayout(page, wizard);
  expect(observed.writes).toEqual([]); expect((await readSaved()).workflow).toEqual(initial.workflow);
  await expect(wizard.getByRole("button", { name: "应用到本页草稿", exact: true })).toBeDisabled();
  await wizard.getByRole("checkbox", { name: "确认已核对工具使用方案", exact: true }).check();
  await wizard.getByRole("button", { name: "应用到本页草稿", exact: true }).click();
  expect(observed.writes).toEqual([]); expect((await readSaved()).workflow).toEqual(initial.workflow);
  await expect(wizard.getByText("工具方案已应用到本页草稿", { exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: "保存当前草稿", exact: true }).click();
  await expect(wizard.getByText("此方案对应的草稿已保存", { exact: true })).toBeVisible();
  const saved = await readSaved();
  expect(observed.writes).toEqual([agentPath]); expect(observed.forbidden).toEqual([]);
  const addedId = saved.workflow.nodes.decision.condition!.defaultNext!;
  expect(addedId).not.toBe(initial.workflow.nodes.decision.condition!.defaultNext);
  const added = saved.workflow.nodes[addedId];
  expect(added).toMatchObject({ type: "tool", title: originalTool.name, next: "loop", tool: { registryToolId: originalTool.id, action: originalTool.action, scope: originalTool.scope, risk: originalTool.risk, maxRetries: 3 } });
  const expectedTool = ToolSpec.parse({ connector: replacement.name, action: replacement.action, scope: replacement.scope, risk: replacement.risk,
    registryToolId: replacement.id, protocol: replacement.protocol ?? "http-json", unresolved: false, maxRetries: 7,
    ...(replacement.operationKind === undefined ? {} : { operationKind: replacement.operationKind }),
    inputSchema: replacement.inputSchema, outputSchema: replacement.outputSchema, intentAction: initial.workflow.nodes.business.tool!.intentAction });
  expect(saved.workflow).toEqual({ ...initial.workflow, nodes: { ...initial.workflow.nodes,
    business: { ...initial.workflow.nodes.business, tool: expectedTool },
    decision: { ...initial.workflow.nodes.decision, condition: { ...initial.workflow.nodes.decision.condition!, defaultNext: addedId } }, [addedId]: added,
  } });
  await wizard.getByRole("button", { name: "返回画布检查", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.reload();
  const businessNode = page.locator('.react-flow__node[data-id="business"]');
  await expect(businessNode).toBeVisible();
  await businessNode.click();
  await expect(businessNode).toHaveClass(/\bselected\b/);
  const inspector = page.getByRole("complementary", { name: "节点详情", exact: true });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("textbox", { name: "节点名称", exact: true })).toHaveValue(saved.workflow.nodes.business.title);
  await expect(inspector.getByRole("combobox", { name: "业务工具", exact: true })).toHaveValue(replacement.id);
  expect((await readSaved()).workflow).toEqual(saved.workflow);
  await desktopLayout(page); expect(observed.errors).toEqual([]); expect(observed.forbidden).toEqual([]);
  await testInfo.attach("工具绑定向导真实保存与刷新", { body: JSON.stringify({ agentPath, registeredToolNames: [originalTool.name, replacement.name], writes: observed.writes, errors: observed.errors,
    mappingPreserved: saved.workflow.nodes.business.inputMapping, operationConfigPreserved: saved.workflow.nodes.business.toolOperation,
    originalBranches: saved.workflow.nodes.decision.condition!.branches, canvasPositions: saved.workflow.ui.positions, toolCallAttemptedBySpec: false,
    isolationProofRequiredFromController: true, isolationVerifiedBySpec: false, savedVersionIsPublished: false }, null, 2), contentType: "application/json" });
  await testInfo.attach("工具绑定桌面实际画布", { body: await page.getByLabel("流程编辑画布", { exact: true }).screenshot(), contentType: "image/png" });
});

test("桌面向导取消不写入，同锚循环完成路径整组撤销重做且只明确保存一次", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const tools = await readActualTools(page);
  const { agentPath, readSaved, initial } = await importDraft(page, tools[0], "工具绑定整组撤销核对-" + Date.now());
  const observed = traceRequests(page, agentPath);
  let wizard = await openWizard(page, [tools[0]]);
  await wizard.getByRole("combobox", { name: "工具 1 使用位置", exact: true }).focus();
  await wizard.getByRole("combobox", { name: "工具 1 使用位置", exact: true }).press("Control+s");
  await expect(wizard.getByRole("alert")).toContainText("请先核对方案并应用到本页草稿");
  await wizard.getByRole("button", { name: "关闭工具绑定向导", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "放弃本次绑定方案？", exact: true });
  await confirmation.getByRole("button", { name: "返回", exact: true }).click();
  await expect(wizard.getByRole("combobox", { name: "工具 1 使用位置", exact: true })).toHaveValue("");
  await wizard.getByRole("button", { name: "取消", exact: true }).click();
  await confirmation.getByRole("button", { name: "放弃本次选择", exact: true }).click();
  await expect(wizard).toHaveCount(0);
  await expect(page.getByRole("button", { name: "应用工具到流程", exact: true })).toBeFocused();
  expect(observed.writes).toEqual([]); expect((await readSaved()).workflow).toEqual(initial.workflow);
  wizard = await openWizard(page, tools);
  await arrange(wizard, 1, "after", "loop"); await arrange(wizard, 2, "after", "loop");
  await reviewAndApply(wizard);
  expect(observed.writes).toEqual([]); expect((await readSaved()).workflow).toEqual(initial.workflow);
  await wizard.getByRole("button", { name: "返回画布检查", exact: true }).click();
  const summary = page.getByRole("region", { name: "业务工具绑定概况", exact: true });
  await expect(summary).toContainText("草稿中 3 个工具步骤");
  await page.getByRole("button", { name: "撤销上一步修改", exact: true }).click();
  await expect(summary).toContainText("草稿中 1 个工具步骤");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重做上一步修改", exact: true }).click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^草稿已保存$/ })).toBeVisible();
  const saved = await readSaved(), firstId = saved.workflow.nodes.loop.loop!.exitNext!, secondId = saved.workflow.nodes[firstId].next!;
  const first = saved.workflow.nodes[firstId], second = saved.workflow.nodes[secondId];
  expect(first).toMatchObject({ type: "tool", title: tools[0].name, next: secondId, tool: { registryToolId: tools[0].id, maxRetries: 3 } });
  expect(second).toMatchObject({ type: "tool", title: tools[1].name, next: "end", tool: { registryToolId: tools[1].id, maxRetries: 3 } });
  const expected: WorkflowDraft = { ...initial.workflow, nodes: { ...initial.workflow.nodes,
    loop: { ...initial.workflow.nodes.loop, loop: { ...initial.workflow.nodes.loop.loop!, exitNext: firstId } }, [firstId]: first, [secondId]: second,
  } };
  expect(saved.workflow).toEqual(expected); expect(observed.writes).toEqual([agentPath]); expect(observed.forbidden).toEqual([]);
  await page.reload(); expect((await readSaved()).workflow).toEqual(expected);
  const loopNode = page.locator('.react-flow__node[data-id="loop"]');
  await expect(loopNode).toBeVisible(); await loopNode.click();
  await expect(loopNode).toHaveClass(/\bselected\b/);
  const inspector = page.getByRole("complementary", { name: "节点详情", exact: true });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByRole("textbox", { name: "节点名称", exact: true })).toHaveValue(initial.workflow.nodes.loop.title);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await desktopLayout(page); expect(observed.errors).toEqual([]);
  await testInfo.attach("工具绑定循环路径与整组历史", { body: JSON.stringify({ agentPath, writes: observed.writes, toolNamesInUserSelectionOrder: tools.map((tool) => tool.name),
    bodyPathUnchanged: saved.workflow.nodes.loop.loop!.bodyNext === initial.workflow.nodes.loop.loop!.bodyNext, uiPositions: saved.workflow.ui.positions,
    errors: observed.errors, toolCallAttemptedBySpec: false, isolationProofRequiredFromController: true, isolationVerifiedBySpec: false }, null, 2), contentType: "application/json" });
});
