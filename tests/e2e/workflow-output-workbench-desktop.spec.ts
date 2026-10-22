import { expect, test } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { VersionExportFile } from "../../src/contracts/version";
import { RunReportFile } from "../../src/contracts/run";
import { outputWorkbenchWorkflowDefinition } from "../fixtures/output-workbench-workflow";

test("桌面交付字段映射、来源定位、保存发布与真实分支产出形成证据", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = "交付定义核对-" + Date.now();
  const definition = outputWorkbenchWorkflowDefinition(name);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/agents/new");
  await expect(page.getByRole("heading", { name: "从文件导入助手", exact: true })).toBeVisible();
  await page.getByLabel("选择助手定义文件").setInputFiles({ name: "output-workflow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  const agentPath = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  const initialResponse = await page.request.get("/api" + agentPath + "/export");
  expect(initialResponse.ok()).toBe(true);
  const initial = AgentExportFile.parse(await initialResponse.json());
  expect(initial.workflow.outputContract!.fields).toEqual(definition.workflow.outputContract!.fields);
  await page.locator("summary").filter({ hasText: "最终交付字段" }).click();
  const outputs = page.getByRole("region", { name: "最终交付定义工作台", exact: true });
  await outputs.getByLabel("交付字段 1 显示名称", { exact: true }).fill("本次路径核对");
  await outputs.getByLabel("交付字段 1 位置", { exact: true }).fill("报告.核对结果");
  await outputs.getByLabel("交付字段 2 位置", { exact: true }).fill("报告");
  await expect(outputs.getByRole("alert")).toHaveCount(2);
  let invalidSavePosts = 0;
  const countPosts = (request: { method(): string }) => { if (request.method() === "POST") invalidSavePosts += 1; };
  page.on("request", countPosts);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByText("最终交付字段位置“报告”与其下级字段冲突", { exact: true }).last()).toBeVisible();
  expect(invalidSavePosts).toBe(0);
  page.off("request", countPosts);
  await outputs.getByLabel("交付字段 2 位置", { exact: true }).fill("报告.路径记录");
  await outputs.getByLabel("交付字段 2 显示名称", { exact: true }).fill("选中处理记录");
  await outputs.getByLabel("交付字段 3 位置", { exact: true }).fill("报告.其他记录");
  await outputs.getByRole("button", { name: "删除交付字段 4", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "删除这项交付定义？", exact: true });
  await expect(confirmation).toContainText("不会删除来源步骤");
  await confirmation.press("Escape");
  await expect(outputs.getByRole("button", { name: "删除交付字段 4", exact: true })).toBeFocused();
  await outputs.getByRole("button", { name: "删除交付字段 4", exact: true }).click();
  await confirmation.getByRole("button", { name: "删除交付定义", exact: true }).click();
  await expect(outputs.getByRole("list", { name: "交付定义列表" }).locator(":scope > li")).toHaveCount(3);
  await outputs.getByRole("button", { name: "上移交付字段 2", exact: true }).click();
  await expect(outputs.getByLabel("交付字段 1 显示名称", { exact: true })).toHaveValue("选中处理记录");
  await expect(outputs.getByLabel("交付字段 1 显示名称", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "撤销上一步修改", exact: true }).click();
  await expect(outputs.getByLabel("交付字段 1 显示名称", { exact: true })).toHaveValue("本次路径核对");
  await page.getByRole("button", { name: "重做上一步修改", exact: true }).click();
  await expect(outputs.getByLabel("交付字段 1 显示名称", { exact: true })).toHaveValue("选中处理记录");
  await outputs.getByLabel("查找交付定义", { exact: true }).fill("本次路径核对");
  await outputs.getByRole("button", { name: "定位交付来源步骤", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "节点详情" });
  await expect(inspector.getByLabel("判断数据", { exact: true })).toHaveValue("input.payload.flag");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const control of [outputs.getByLabel("交付字段 2 位置", { exact: true }), outputs.getByLabel("交付字段 2 显示名称", { exact: true }), outputs.getByRole("button", { name: "下移交付字段 2", exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest('section[aria-label="最终交付定义工作台"]')!.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right, hit: hit === element || element.contains(hit) };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(bounds.panelLeft - 1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.panelRight + 1);
      expect(bounds.hit).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await outputs.screenshot({ path: "qa/workflow-output-workbench-desktop.png" });
  await outputs.getByLabel("查找交付定义", { exact: true }).fill("不存在的交付");
  await expect(outputs).toContainText("没有匹配的交付定义，原定义没有删除。");
  await outputs.getByRole("button", { name: "查看全部交付定义", exact: true }).click();
  const originals = definition.workflow.outputContract!.fields;
  const expected = [
    { ...originals[1], path: "报告.路径记录", label: "选中处理记录" },
    { ...originals[0], path: "报告.核对结果", label: "本次路径核对" },
    { ...originals[2], path: "报告.其他记录" },
  ];
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  const savedResponse = await page.request.get("/api" + agentPath + "/export");
  expect(savedResponse.ok()).toBe(true);
  const saved = AgentExportFile.parse(await savedResponse.json());
  expect(saved.workflow.outputContract!.fields).toEqual(expected);
  expect(saved.workflow.nodes).toEqual(initial.workflow.nodes);
  await page.reload();
  await page.locator("summary").filter({ hasText: "最终交付字段" }).click();
  await expect(outputs.getByLabel("交付字段 2 位置", { exact: true })).toHaveValue("报告.核对结果");
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible();
  const frozenHref = (await page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true }).getAttribute("href"))!;
  const frozenResponse = await page.request.get(frozenHref);
  expect(frozenResponse.ok()).toBe(true);
  const frozen = VersionExportFile.parse(await frozenResponse.json());
  expect(frozen.manifest.outputContract!.fields).toEqual(expected);
  expect(frozen.manifest.workflowSnapshot.outputContract!.fields).toEqual(expected);
  await outputs.getByLabel("交付字段 2 显示名称", { exact: true }).fill("尚未发布的新交付名称");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  const newerResponse = await page.request.get("/api" + agentPath + "/export");
  expect(newerResponse.ok()).toBe(true);
  const newer = AgentExportFile.parse(await newerResponse.json());
  expect(newer.workflow.outputContract!.fields[1].label).toBe("尚未发布的新交付名称");
  const launcher = page.locator("#run");
  await expect(launcher.getByText("本次路径核对", { exact: true })).toBeVisible();
  await expect(launcher.getByText("尚未发布的新交付名称", { exact: true })).toHaveCount(0);
  await expect(launcher.getByText("（可选交付）", { exact: true })).toBeVisible();
  await expect(launcher).toContainText("可选交付仅在来源有实际产出时提供");
  expect(frozen.manifest.inputContract.fields).toHaveLength(1);
  const inputField = frozen.manifest.inputContract.fields[0];
  const input = { payload: { flag: "待核对", count: 0 } };
  expect(inputField.name).toBe("payload");
  expect(inputField.type).toBe("object");
  const label = inputField.label?.trim() || "业务信息 1";
  await launcher.getByLabel(label + "（必填）", { exact: true }).fill(JSON.stringify(input.payload));
  if (process.env.CAPTURE_UI_AUDIT === "1") { await launcher.scrollIntoViewIfNeeded(); await launcher.screenshot({ path: "qa/workflow-output-launcher-desktop.png" }); }
  await launcher.getByRole("button", { name: "开始试运行", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/);
  const runPath = new URL(page.url()).pathname;
  let report: ReturnType<typeof RunReportFile.parse> | undefined;
  await expect.poll(async () => {
    const response = await page.request.get("/api" + runPath + "/export");
    expect(response.ok()).toBe(true);
    report = RunReportFile.parse(await response.json());
    return report.run.status;
  }, { timeout: 180_000, intervals: [1000, 2000, 4000] }).toBe("completed");
  expect(report!.run.input).toEqual(input);
  expect(report!.run.version).toBe(frozen.version.number);
  const decision = report!.steps.find((step) => step.nodeId === "decision")!;
  const selected = report!.steps.find((step) => step.nodeId === "text")!;
  expect(decision.output).toEqual({ matched: "文字命中", next: "text" });
  expect(selected.status).toBe("succeeded");
  expect(report!.steps.some((step) => step.nodeId === "fallback")).toBe(false);
  expect(report!.run.result).toEqual({ 报告: { 路径记录: selected.output, 核对结果: decision.output } });
  await expect(page.getByText("运行已完成", { exact: true })).toBeVisible();
  const resultPreview = page.locator("#result").getByRole("group", { name: "条件结果核对" });
  await expect(resultPreview).toContainText("命中的分支");
  await expect(resultPreview).toContainText("文字命中");
  await expect(resultPreview).toContainText(selected.nodeTitle!);
  await expect(resultPreview.getByText("text", { exact: true })).toHaveCount(0);
  await expect(page.locator("#result pre")).toContainText('"next": "text"');
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/workflow-output-result-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
  await testInfo.attach("真实交付定义保存与分支产出", { body: JSON.stringify({
    agentPath, runPath, initialFields: initial.workflow.outputContract!.fields, savedFields: saved.workflow.outputContract!.fields,
    frozenVersion: frozen.version.number, frozenFields: frozen.manifest.outputContract!.fields, newerDraftFields: newer.workflow.outputContract!.fields,
    input: report!.run.input, decision: decision.output, selectedOutput: selected.output, result: report!.run.result, invalidSavePosts, errors,
  }, null, 2), contentType: "application/json" });
});
