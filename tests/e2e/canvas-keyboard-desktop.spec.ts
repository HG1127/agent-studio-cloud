import { expect, test, type Locator } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { VersionExportFile } from "../../src/contracts/version";
import { WorkflowDraft } from "../../src/contracts/workflow";
import { updateWorkflowNode } from "../../src/features/workflow-canvas/update-workflow-node";
import { compileModelWorkflowPlan } from "../../src/server/domain/compile/model-workflow-compiler";
import { importedWorkflowIssue } from "../../src/server/domain/import-agent";
import { finalizeAgentDraft } from "../../src/server/domain/pipeline";

const LOOP_TITLE = "逐项核对清单";
const BODY_TITLE = "核对单项资料";
const SAVED_BODY_TITLE = "核对单项资料并整理记录";

function keyboardDefinition(name: string) {
  const steps = [
    { id: "loop", title: LOOP_TITLE, type: "loop", evidence: "逐项读取本次输入清单，最多核对三项资料", loop: {
      collectionPath: "input.items", itemKey: "currentItem", maxIterations: 3, bodyNext: "body", exitNext: "deliver",
    } },
    { id: "body", title: BODY_TITLE, type: "ai", evidence: "核对当前一项资料并形成该项记录，之后回到逐项核对", next: "loop" },
    { id: "deliver", title: "整理本轮核对记录", type: "ai", evidence: "根据本轮已保存记录整理核对结果" },
  ];
  const intentText = steps.map((step) => step.evidence).join("，");
  const compiled = compileModelWorkflowPlan({ name, sourceText: intentText, intent: { orderedSteps: steps } });
  if (!compiled) throw new Error("实际编译器未生成键盘验收定义");
  // 通用计划编译器会改写普通回指；这里明确构造共享契约允许的受控循环测试定义。
  compiled.workflow.nodes.body = { ...compiled.workflow.nodes.body, next: "loop" };
  compiled.workflow.variables = [{ name: "items", label: "待核对清单", type: "array", scope: "run", required: true }];
  const prepared = finalizeAgentDraft({ name, intentText, workflow: WorkflowDraft.parse(compiled.workflow),
    orderedSteps: compiled.orderedSteps as Parameters<typeof finalizeAgentDraft>[0]["orderedSteps"] });
  if (!prepared.draft || prepared.issues.some((issue) => issue.severity === "critical")) throw new Error("真实设计检查未允许受控循环定义，不以伪造发布成功代替");
  const draft = WorkflowDraft.parse(prepared.draft);
  if (draft.nodes.loop.type !== "loop" || draft.nodes.loop.loop?.collectionPath !== "input.items"
    || draft.nodes.loop.loop.bodyNext !== "body" || draft.nodes.loop.loop.exitNext !== "deliver" || draft.nodes.body.next !== "loop") {
    throw new Error("准备后的真实定义没有保留受控循环路径");
  }
  draft.ui.positions = Object.fromEntries(Object.keys(draft.nodes).map((id, index) => [id, { x: index % 3 * 290, y: Math.floor(index / 3) * 175 }]));
  const issue = importedWorkflowIssue(draft);
  if (issue) throw new Error("真实导入契约拒绝测试定义：" + issue);
  return AgentExportFile.parse({ format: "agent-studio-cloud", formatVersion: 1, exportedAt: new Date().toISOString(),
    agent: { name, description: "隔离桌面画布键盘与只读路径验收，不启动业务运行", intentText }, workflow: draft });
}

async function viewportState(viewport: Locator) {
  return viewport.locator(".react-flow__viewport").evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    const rounded = (value: number) => Math.round(value * 100000) / 100000;
    return { zoom: rounded(matrix.a), x: rounded(matrix.e), y: rounded(matrix.f) };
  });
}

async function settledViewport(viewport: Locator) {
  let previous = "";
  let consecutive = 0;
  let snapshot = await viewportState(viewport);
  await expect.poll(async () => {
    snapshot = await viewportState(viewport);
    const value = JSON.stringify(snapshot);
    consecutive = value === previous ? consecutive + 1 : 0;
    previous = value;
    return consecutive;
  }, { timeout: 10000, intervals: [100] }).toBeGreaterThanOrEqual(3);
  return snapshot;
}

async function viewKeys(viewport: Locator) {
  await expect(viewport).toHaveAttribute("tabindex", "0");
  await viewport.focus();
  await expect(viewport).toBeFocused();
  for (const [larger, smaller] of [
    ["Shift+Equal", "Minus"], ["Equal", "Minus"],
    ["Control+Equal", "Control+Minus"], ["Meta+Equal", "Meta+Minus"],
    ["Control+Shift+Equal", "Control+Minus"], ["Meta+Shift+Equal", "Meta+Minus"],
  ]) {
    const before = await settledViewport(viewport);
    await viewport.press(larger);
    const enlarged = await settledViewport(viewport);
    expect(enlarged.zoom).toBeGreaterThan(before.zoom);
    await viewport.press(smaller);
    expect((await settledViewport(viewport)).zoom).toBeLessThan(enlarged.zoom);
  }
  for (const fit of ["Digit0", "Control+Digit0", "Meta+Digit0"]) {
    await viewport.press("Equal");
    const enlarged = await settledViewport(viewport);
    await viewport.press(fit);
    const fitted = await settledViewport(viewport);
    expect(fitted).not.toEqual(enlarged);
    expect(fitted.zoom).toBeGreaterThan(0);
  }
}

async function untouchedByKeys(viewport: Locator, control: Locator, keys: readonly string[]) {
  await control.focus();
  await expect(control).toBeFocused();
  const before = await settledViewport(viewport);
  for (const key of keys) {
    await control.press(key);
    expect(await settledViewport(viewport)).toEqual(before);
  }
}

test("桌面真实画布键盘选择、查看缩放与循环定位，保存发布读回后冻结仍只读", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1") {
    throw new Error("需专用CI证明隔离数据库归属并显式配置演示模型，才能创建和发布键盘验收数据；条件不足不skip、不回退生产环境");
  }
  const name = "画布键盘核对-" + Date.now();
  const definition = keyboardDefinition(name);
  let phase = "import";
  const writes: { phase: string; method: string; path: string }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push({ phase, method: request.method(), path: new URL(request.url()).pathname });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents/new");
  await expect(page.getByRole("heading", { name: "从文件导入助手", exact: true })).toBeVisible();
  await page.getByLabel("选择助手定义文件").setInputFiles({ name: "canvas-keyboard.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/i);
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  const agentPath = new URL(page.url()).pathname;
  const readDraft = async () => {
    const response = await page.request.get("/api" + agentPath + "/export");
    expect(response.ok()).toBe(true);
    return AgentExportFile.parse(await response.json());
  };
  const original = await readDraft();
  expect(original.workflow.nodes.loop.loop).toEqual(definition.workflow.nodes.loop.loop);
  expect(original.workflow.nodes.body.next).toBe("loop");
  const save = page.getByRole("button", { name: "保存草稿", exact: true });
  const editViewport = page.getByLabel("流程编辑画布", { exact: true });
  const inspector = page.getByRole("complementary", { name: "节点详情" });
  const editNode = (id: string) => editViewport.locator('.react-flow__node[data-id="' + id + '"]');
  phase = "draft-view";
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(editViewport).toBeVisible();
    await editNode("loop").focus();
    await editNode("loop").press("Enter");
    await expect(editNode("loop")).toHaveClass(/selected/);
    await expect(inspector.getByRole("textbox", { name: "节点名称", exact: true })).toHaveValue(LOOP_TITLE);
    await expect(inspector.getByRole("region", { name: "循环内直接路径", exact: true })).toContainText("直接连接已指回当前循环");
    await editNode("body").focus();
    await editNode("body").press("Space");
    await expect(editNode("body")).toHaveClass(/selected/);
    await expect(inspector.getByRole("textbox", { name: "节点名称", exact: true })).toHaveValue(BODY_TITLE);
    await editNode("body").press("Escape");
    await expect(inspector).toHaveCount(0);
    await editNode("loop").press("Enter");
    await inspector.getByRole("region", { name: "循环内直接路径", exact: true }).getByRole("button", { name: new RegExp("^" + BODY_TITLE + "\\s*· 定位步骤$") }).click();
    await expect(inspector.getByRole("textbox", { name: "节点名称", exact: true })).toHaveValue(BODY_TITLE);
    await viewKeys(editViewport);
    await expect(save).toBeDisabled();
    await expect(page.getByText("有未保存修改", { exact: true })).toHaveCount(0);
    const search = page.getByRole("textbox", { name: "搜索流程步骤", exact: true });
    await untouchedByKeys(editViewport, search, ["Shift+Equal", "Equal", "Minus", "Digit0"]);
    await expect(search).toHaveValue("+=-0");
    await untouchedByKeys(editViewport, search, ["Control+Equal", "Meta+Minus", "Control+Digit0", "Meta+Digit0"]);
    await search.fill("");
    const title = inspector.getByRole("textbox", { name: "节点名称", exact: true });
    await title.focus(); await title.press("End");
    await untouchedByKeys(editViewport, title, ["Shift+Equal", "Equal", "Minus", "Digit0"]);
    await expect(title).toHaveValue(BODY_TITLE + "+=-0");
    await untouchedByKeys(editViewport, title, ["Control+Equal", "Meta+Minus", "Control+Digit0", "Meta+Digit0"]);
    await title.fill(BODY_TITLE);
    await expect(save).toBeDisabled();
    await inspector.getByRole("button", { name: "删除节点", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "删除这个节点？", exact: true });
    await expect(confirmation).toBeVisible();
    await untouchedByKeys(editViewport, confirmation.getByRole("button", { name: "返回", exact: true }), ["Equal", "Minus", "Digit0", "Control+Equal", "Meta+Minus"]);
    await confirmation.getByRole("button", { name: "返回", exact: true }).click();
    await untouchedByKeys(editViewport, page.locator("#versions").getByRole("button", { name: "发布新版本", exact: true }), ["Equal", "Minus", "Digit0"]);
    await expect(save).toBeDisabled();
    expect((await readDraft()).workflow).toEqual(original.workflow);
    expect(writes.filter((write) => write.phase === "draft-view")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  phase = "save";
  await editNode("body").press("Enter");
  await inspector.getByRole("textbox", { name: "节点名称", exact: true }).fill(SAVED_BODY_TITLE);
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: /^草稿已保存$/ })).toBeVisible();
  await expect(save).toBeDisabled();
  const saved = await readDraft();
  const expectedSaved = updateWorkflowNode(original.workflow, "body", { ...original.workflow.nodes.body, title: SAVED_BODY_TITLE });
  expect(saved.workflow).toEqual(expectedSaved);
  expect(saved.workflow.nodes.body.title).toBe(SAVED_BODY_TITLE);
  expect(saved.workflow.nodes.loop.loop).toEqual(original.workflow.nodes.loop.loop);
  expect(saved.workflow.nodes.body.next).toBe("loop");
  await page.reload();
  phase = "publish";
  await page.locator("#versions").getByRole("button", { name: "发布新版本", exact: true }).click();
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible();
  const frozenExportPath = await page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true }).getAttribute("href");
  if (!frozenExportPath || !new RegExp("^/api" + agentPath + "/versions/[0-9a-f-]{36}/export$", "i").test(frozenExportPath)) throw new Error("必须从真实同助手发布记录取得确切冻结版本");
  const readFrozen = async () => {
    const response = await page.request.get(frozenExportPath);
    expect(response.ok()).toBe(true);
    return VersionExportFile.parse(await response.json());
  };
  const frozen = await readFrozen();
  expect(frozen.manifest.resourceSelection.model.mock).toBe(true);
  expect(frozen.manifest.workflowSnapshot.nodes.loop.loop).toEqual(saved.workflow.nodes.loop.loop);
  expect(frozen.manifest.workflowSnapshot.nodes.body).toEqual(saved.workflow.nodes.body);
  expect(frozen.manifest.workflowSnapshot.ui.positions).toEqual(saved.workflow.ui.positions);
  const frozenEntry = page.locator("#versions").getByRole("link", { name: "查看冻结流程", exact: true });
  await expect(frozenEntry).toHaveCount(1);
  phase = "frozen-view";
  await frozenEntry.click();
  const frozenViewport = page.getByLabel("冻结流程只读画布", { exact: true });
  const frozenNode = (id: string) => frozenViewport.locator('.react-flow__node[data-id="' + id + '"]');
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(frozenViewport).toBeVisible();
    await expect(frozenViewport.locator(".react-flow__node")).toHaveCount(Object.keys(frozen.manifest.workflowSnapshot.nodes).length);
    await frozenNode("loop").press("Enter");
    const loopDetails = page.getByRole("region", { name: LOOP_TITLE, exact: true });
    await expect(loopDetails.getByRole("heading", { name: LOOP_TITLE, exact: true })).toBeVisible();
    await expect(loopDetails.getByRole("region", { name: "循环内直接路径", exact: true })).toContainText("冻结定义");
    await expect(loopDetails.getByRole("region", { name: "循环内直接路径", exact: true })).toContainText("直接连接已指回当前循环");
    await frozenNode("body").press("Space");
    await expect(page.getByRole("region", { name: SAVED_BODY_TITLE, exact: true }).getByRole("heading", { name: SAVED_BODY_TITLE, exact: true })).toBeVisible();
    await frozenNode("body").press("Escape");
    await expect(page.getByRole("region", { name: SAVED_BODY_TITLE, exact: true })).toHaveCount(0);
    await frozenNode("loop").press("Enter");
    await loopDetails.getByRole("region", { name: "循环内直接路径", exact: true }).getByRole("button", { name: new RegExp("^" + SAVED_BODY_TITLE + "\\s*· 定位步骤$") }).click();
    await expect(page.getByRole("region", { name: SAVED_BODY_TITLE, exact: true }).getByRole("heading", { name: SAVED_BODY_TITLE, exact: true })).toBeFocused();
    await viewKeys(frozenViewport);
    const search = page.getByRole("searchbox", { name: "按保存的名称或说明查找", exact: true });
    await untouchedByKeys(frozenViewport, search, ["Shift+Equal", "Equal", "Minus", "Digit0"]);
    await expect(search).toHaveValue("+=-0");
    await untouchedByKeys(frozenViewport, search, ["Control+Equal", "Meta+Minus", "Control+Digit0", "Meta+Digit0"]);
    await search.fill("");
    await untouchedByKeys(frozenViewport, page.getByRole("link", { name: "返回版本历史", exact: true }), ["Equal", "Minus", "Digit0"]);
    await expect(page.getByRole("button", { name: /保存草稿|发布新版本|删除节点|开始运行|开始试运行/ })).toHaveCount(0);
    expect((await readFrozen()).manifest).toEqual(frozen.manifest);
    expect((await readDraft()).workflow).toEqual(saved.workflow);
    expect(writes.filter((write) => write.phase === "frozen-view")).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(writes.filter((write) => write.phase === "save")).toEqual([{ phase: "save", method: "POST", path: agentPath }]);
  expect(writes.filter((write) => write.phase === "publish")).toEqual([{ phase: "publish", method: "POST", path: agentPath }]);
  expect(writes.some((write) => /^\/api\/(?:runs|tool-operations|mcp)/.test(write.path))).toBe(false);
  expect(errors).toEqual([]);
  await testInfo.attach("真实画布键盘与冻结只读范围", { body: JSON.stringify({ viewportWidths: [1280, 1440], actualUiImport: true, actualUiSave: true,
    actualUiPublish: true, draftLoopReadBack: saved.workflow.nodes.loop.loop, bodyReturnsToLoop: saved.workflow.nodes.body.next === "loop",
    frozenVersion: frozen.version.number, keyboardEnterAndSpace: true, viewWrites: 0, frozenWrites: 0, writes, errors,
    inputCharactersRemainLocalUntilExplicitSave: true, workflowRunStarted: false, externalBusinessToolCalled: false }), contentType: "application/json" });
});
