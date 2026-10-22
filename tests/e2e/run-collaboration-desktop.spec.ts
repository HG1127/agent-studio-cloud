import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { RunReportFile } from "../../src/contracts/run";
import { childRunHref, collaborationNavigation } from "../../src/features/runs/run-collaboration-navigation";
import { compiledCollaborationDefinition } from "../fixtures/runtime-collaboration";

async function waitForAssistantWorkspace(page: Page, name: string) {
  const heading = page.getByRole("heading", { name, level: 1 });
  const loading = page.getByRole("main", { name: "正在读取助手工作台", exact: true });
  const reload = loading.getByRole("button", { name: "重新加载", exact: true });
  await expect(heading.or(reload).first()).toBeVisible();
  if (await reload.isVisible()) {
    await expect(loading).toContainText("不会保存流程、发布版本或启动运行");
    const savedUrl = page.url();
    const writes: string[] = [];
    const observeWrite = (request: import("@playwright/test").Request) => {
      if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
    };
    page.on("request", observeWrite);
    await reload.click();
    await expect(heading).toBeVisible();
    await expect(page).toHaveURL(savedUrl);
    page.off("request", observeWrite);
    expect(writes).toEqual([]);
    await test.info().attach("同一助手详情的只读重新加载", { body: JSON.stringify({ savedUrl, writes }), contentType: "application/json" });
  } else {
    await expect(heading).toBeVisible();
  }
}

async function createAssistant(page: Page, name: string, intent = "根据客户咨询整理回复草稿，输出可核对的回复内容") {
  await page.goto("/agents/new");
  await page.getByLabel("助手名称").fill(name);
  await page.getByLabel("想让助手完成什么（至少 10 个字）").fill(intent);
  await page.getByRole("button", { name: "创建助手", exact: true }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  await waitForAssistantWorkspace(page, name);
  const agentId = new URL(page.url()).pathname.split("/").at(-1)!;
  const response = await page.request.get(`/api/agents/${agentId}/export`);
  expect(response.ok()).toBe(true);
  return { agentId, definition: AgentExportFile.parse(await response.json()) };
}

const stamp = Date.now();
const targetName = `协作结果验收-${stamp}`;
const parentName = `协作运行验收-${stamp}`;
const importedName = parentName + "-导入";
let target: Awaited<ReturnType<typeof createAssistant>>;
let targetVersionId: string;
let importedDefinition: ReturnType<typeof compiledCollaborationDefinition>;
let parentAgentId: string;
let parentPath: string;
let parentRunId: string;
let realChildren: Array<ReturnType<typeof RunReportFile.parse>["run"]>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(360_000);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    target = await createAssistant(page, targetName, "根据客户咨询整理可核对的回复草稿");
    expect(Object.values(target.definition.workflow.nodes).filter((node) => node.type === "ai")).toHaveLength(1);
    expect(Object.values(target.definition.workflow.nodes).some((node) => node.type === "human")).toBe(false);
    await page.getByRole("button", { name: "发布新版本", exact: true }).click();
    await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible();
    const frozenHref = await page.locator("#versions").getByRole("link", { name: "查看冻结流程", exact: true }).getAttribute("href");
    expect(frozenHref).toBeTruthy();
    targetVersionId = new URL(frozenHref!, page.url()).pathname.split("/").at(-1)!;
  } finally {
    await page.close();
  }
});

test("桌面协作绑定真实保存，缺少业务规格时阻止发布", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const parent = await createAssistant(page, parentName);
  const aiNode = Object.values(parent.definition.workflow.nodes).find((node) => node.type === "ai");
  expect(aiNode, "使用真实生成的流程插入协作，不直接写入数据库").toBeDefined();
  const inspector = page.getByRole("complementary", { name: "节点详情" });
  await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("agent_call");
  await page.getByRole("combobox", { name: "新增步骤位置" }).selectOption(aiNode!.id);
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await inspector.getByLabel("节点名称", { exact: true }).fill("协作核对回复");
  await inspector.getByRole("combobox", { name: "协作助手", exact: true }).selectOption(targetVersionId);
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  const callId = await page.getByRole("combobox", { name: "定位流程步骤" }).locator("option").filter({ hasText: "协作核对回复" }).getAttribute("value");
  expect(callId).toBeTruthy();
  await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("handoff");
  await page.getByRole("combobox", { name: "新增步骤位置" }).selectOption(callId!);
  await page.getByRole("button", { name: "插入", exact: true }).click();
  await inspector.getByLabel("节点名称", { exact: true }).fill("交接核对回复");
  await inspector.getByRole("combobox", { name: "接收助手", exact: true }).selectOption(targetVersionId);
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /^草稿已保存$/ })).toBeVisible();
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  await expect(page.locator("#versions").getByRole("alert")).toContainText("业务节点没有业务规格");
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).not.toBeVisible();
  const savedResponse = await page.request.get(`/api/agents/${parent.agentId}/export`);
  expect(savedResponse.ok()).toBe(true);
  const savedDefinition = AgentExportFile.parse(await savedResponse.json());
  importedDefinition = compiledCollaborationDefinition(importedName, savedDefinition.workflow);
  await testInfo.attach("由现有服务端纯编译管道生成的导入定义", { body: JSON.stringify(importedDefinition, null, 2), contentType: "application/json" });
});

test("桌面真实呼叫与交接运行，保存两个固定版本子任务的完成证据", async ({ page }, testInfo) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents/new");
  await expect(page.getByRole("heading", { name: "从文件导入助手", exact: true })).toBeVisible();
  await page.getByLabel("选择助手定义文件").setInputFiles({ name: "runtime-collaboration.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(importedDefinition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  await waitForAssistantWorkspace(page, importedName);
  parentAgentId = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible();
  await page.getByLabel("业务输入（必填）").fill("核对客户询问的回复内容，保留清楚的答复草稿");
  await page.getByRole("button", { name: "开始试运行", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/);
  parentPath = new URL(page.url()).pathname;
  parentRunId = parentPath.split("/").at(-1)!;
  await expect(page.getByRole("heading", { name: "结果与执行证据已保存" })).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "重新读取状态" }).click();
  const section = page.getByRole("region", { name: "协作子任务", exact: true });
  await expect(section.getByRole("table").getByRole("row")).toHaveCount(3);
  const parentResponse = await page.request.get(`/api/runs/${parentRunId}/export`);
  expect(parentResponse.ok()).toBe(true);
  const parentReport = RunReportFile.parse(await parentResponse.json());
  expect(parentReport.run.status).toBe("completed");
  expect(parentReport.steps.some((step) => step.nodeType === "agent_call" && step.status === "succeeded")).toBe(true);
  expect(parentReport.steps.some((step) => step.nodeType === "handoff" && step.status === "succeeded")).toBe(true);
  realChildren = [];
  for (const row of await section.getByRole("table").getByRole("row").all()) {
    const link = row.getByRole("link", { name: `查看子任务：${targetName}`, exact: true });
    if (await link.count() === 0) continue;
    const url = new URL((await link.getAttribute("href"))!, page.url());
    const response = await page.request.get(`/api${url.pathname}/export`);
    expect(response.ok()).toBe(true);
    const report = RunReportFile.parse(await response.json());
    expect(report.run.parentRunId).toBe(parentRunId);
    expect(report.run.versionId).toBe(targetVersionId);
    expect(report.run.agentId).toBe(target.agentId);
    expect(report.run.status).toBe("completed");
    realChildren.push(report.run);
  }
  expect(realChildren.map((run) => run.sourceType).sort()).toEqual(["agent_call", "handoff"]);
  await testInfo.attach("真实协作关系", { body: JSON.stringify({ parentRunId, targetAgentId: target.agentId, targetVersionId, children: realChildren.map(({ id, parentRunId, versionId, sourceType, status }) => ({ id, parentRunId, versionId, sourceType, status })) }, null, 2), contentType: "application/json" });
});

test("桌面协作记录可筛选、核对固定版本并按原位置返回，查看不触发写操作", async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  const outer = `/runs?source=manual&agent=${parentAgentId}`;
  await page.goto(`${parentPath}?${new URLSearchParams({ from: outer })}#collaboration`);
  const section = page.getByRole("region", { name: "协作子任务", exact: true });
  await section.getByRole("searchbox", { name: "搜索协作助手" }).fill(targetName);
  await section.getByRole("combobox", { name: "协作方式" }).selectOption("handoff");
  await section.getByRole("combobox", { name: "子任务状态" }).selectOption("completed");
  await section.getByRole("button", { name: "应用协作筛选" }).click();
  await expect(section.getByRole("status")).toContainText("共 1 项匹配记录");
  const selectedParentUrl = page.url();
  const state = collaborationNavigation(Object.fromEntries(new URL(selectedParentUrl).searchParams)).state;
  const childLink = section.getByRole("link", { name: `查看子任务：${targetName}`, exact: true });
  const childId = realChildren.find((run) => run.sourceType === "handoff")!.id;
  await expect(childLink).toHaveAttribute("href", childRunHref(childId, parentRunId, outer, state));
  await childLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: targetName, level: 1 })).toBeVisible();
  const back = page.getByRole("link", { name: "返回上级协作记录", exact: true });
  const expectedBackHref = new URL(selectedParentUrl).pathname + new URL(selectedParentUrl).search + "#collaboration";
  await expect(back).toHaveAttribute("href", expectedBackHref);
  await expect(page.getByRole("link", { name: "查看上级运行", exact: true })).toHaveAttribute("href", expectedBackHref);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/run-collaboration-child-desktop.png" });
  await back.click();
  await expect(section.getByRole("searchbox", { name: "搜索协作助手" })).toHaveValue(targetName);
  await expect(section.getByRole("combobox", { name: "协作方式" })).toHaveValue("handoff");
  await expect(section.getByRole("status")).toContainText("共 1 项匹配记录");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/run-collaboration-desktop.png" });
  await page.goto(`${selectedParentUrl.replace(/#.*$/, "")}&colPage=2#collaboration`);
  await expect(section.getByRole("heading", { name: "当前页没有协作子任务" })).toBeVisible();
  await section.getByRole("link", { name: "回到协作第一页" }).click();
  await expect(section.getByRole("status")).toContainText("共 1 项匹配记录");
  await section.getByRole("link", { name: "清除协作筛选" }).click();
  await expect(section.getByRole("status")).toContainText("共 2 项匹配记录");
  await expect(section.getByRole("searchbox", { name: "搜索协作助手" })).toHaveValue("");
  await expect(section.getByRole("combobox", { name: "协作方式" })).toHaveValue("");
  await section.getByRole("searchbox", { name: "搜索协作助手" }).fill("没有这项协作");
  await section.getByRole("button", { name: "应用协作筛选" }).click();
  await expect(section.getByRole("heading", { name: "没有符合条件的协作子任务" })).toBeVisible();
  await page.goto(`${parentPath}?colStatus=failed&colStatus=completed#collaboration`);
  await expect(section.getByRole("alert")).toContainText("协作筛选条件无法读取");
  await expect(section.getByRole("table").getByRole("row")).toHaveCount(3);
  await page.goto(`/runs/${childId}?${new URLSearchParams({ parent: target.agentId, from: outer })}`);
  await expect(page.locator("main").getByRole("alert").filter({ hasText: "协作返回位置未能核对" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看上级运行" })).toHaveAttribute("href", `${parentPath}?${new URLSearchParams({ from: outer })}#collaboration`);
  await expect(page.getByRole("link", { name: "返回筛选结果" })).toHaveAttribute("href", outer);
  expect(writes).toEqual([]);
});
