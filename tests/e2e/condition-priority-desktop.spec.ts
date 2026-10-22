import { expect, test } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { VersionExportFile } from "../../src/contracts/version";
import { RunReportFile } from "../../src/contracts/run";
import { conditionWorkflowDefinition } from "../fixtures/condition-workflow";

test("桌面条件类型与优先级真实保存、撤销恢复并决定实际运行路径", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = "条件路径验收-" + Date.now();
  const definition = conditionWorkflowDefinition(name);
  const original = Object.values(definition.workflow.nodes).find((node) => node.type === "condition")!;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/agents/new");
  await expect(page.getByRole("heading", { name: "从文件导入助手", exact: true })).toBeVisible();
  await page.getByLabel("选择助手定义文件").setInputFiles({ name: "condition-workflow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  const agentPath = new URL(page.url()).pathname;
  const inspector = page.getByRole("complementary", { name: "节点详情" });
  await page.getByRole("combobox", { name: "定位流程步骤" }).selectOption(original.id);
  await expect(inspector.getByLabel("情况 1 比较值类型")).toHaveValue("string");
  await inspector.getByLabel("情况 1 比较值", { exact: true }).fill("false");
  await inspector.getByLabel("情况 2 条件 1 比较值", { exact: true }).fill("0");
  await inspector.getByLabel("情况 3 条件 1 比较值", { exact: true }).selectOption("false");
  await inspector.getByRole("button", { name: "提前判断情况 3", exact: true }).click();
  await expect(inspector.getByLabel("情况 2 名称")).toHaveValue("否值命中");
  await page.getByRole("button", { name: "撤销上一步修改", exact: true }).click();
  await expect(inspector.getByLabel("情况 2 名称")).toHaveValue("通用命中");
  await page.getByRole("button", { name: "重做上一步修改", exact: true }).click();
  await expect(inspector.getByLabel("情况 2 名称")).toHaveValue("否值命中");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const control of [inspector.getByLabel("情况 2 条件 1 比较值类型"), inspector.getByRole("button", { name: "提前判断情况 2", exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest("aside")!.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right, hit: hit === element || element.contains(hit) };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(bounds.panelLeft - 1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.panelRight + 1);
      expect(bounds.hit).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/condition-priority-desktop.png" });
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  const savedResponse = await page.request.get("/api" + agentPath + "/export");
  expect(savedResponse.ok()).toBe(true);
  const saved = AgentExportFile.parse(await savedResponse.json());
  const expected = { ...original.condition!, branches: [
    { ...original.condition!.branches[0], value: "false" },
    { ...original.condition!.branches[2], rules: [{ ...original.condition!.branches[2].rules![0], value: false }] },
    { ...original.condition!.branches[1], rules: [{ ...original.condition!.branches[1].rules![0], value: 0 }] },
  ] };
  expect(saved.workflow.nodes[original.id].condition).toEqual(expected);
  await page.reload();
  await page.getByRole("combobox", { name: "定位流程步骤" }).selectOption(original.id);
  await expect(inspector.getByLabel("情况 1 比较值", { exact: true })).toHaveValue("false");
  await expect(inspector.getByLabel("情况 2 条件 1 比较值", { exact: true })).toHaveValue("false");
  await expect(inspector.getByLabel("情况 3 条件 1 比较值", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible();
  const frozenResponse = await page.request.get((await page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true }).getAttribute("href"))!);
  expect(frozenResponse.ok()).toBe(true);
  const frozen = VersionExportFile.parse(await frozenResponse.json());
  expect(frozen.manifest.workflowSnapshot.nodes[original.id].condition).toEqual(expected);
  const payloadField = frozen.manifest.inputContract.fields.find((field) => field.name === "payload")!;
  expect(payloadField.type).toBe("object");
  const evidence = [];
  for (const [payload, matched, branchIndex] of [
    [{ flag: false, count: 0 }, "否值命中", 1],
    [{ flag: "false", count: 0 }, "文字命中", 0],
    [{ flag: true, count: 0 }, "通用命中", 2],
    [{ count: -1 }, "默认分支", -1],
  ] as const) {
    await page.goto(agentPath + "#run");
    await page.locator("#run").getByLabel(payloadField.label?.trim() || "业务信息 1").fill(JSON.stringify(payload));
    await page.getByRole("button", { name: "开始试运行", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]+$/);
    const runPath = new URL(page.url()).pathname;
    let report: ReturnType<typeof RunReportFile.parse> | undefined;
    await expect.poll(async () => {
      const response = await page.request.get("/api" + runPath + "/export");
      expect(response.ok()).toBe(true);
      report = RunReportFile.parse(await response.json());
      return report.run.status;
    }, { timeout: 150_000, intervals: [1000, 2000, 4000] }).toBe("completed");
    expect(report!.run.agentId).toBe(agentPath.split("/").at(-1));
    expect(report!.run.version).toBe(frozen.version.number);
    expect(report!.run.input).toEqual({ payload });
    const decision = report!.steps.find((step) => step.nodeId === original.id)!;
    const target = branchIndex < 0 ? expected.defaultNext : expected.branches[branchIndex].next;
    expect(decision.status).toBe("succeeded");
    expect(decision.output).toEqual({ matched, next: target });
    expect(report!.steps.some((step) => step.nodeId === target && step.status === "succeeded")).toBe(true);
    const allTargets = [...expected.branches.map((branch) => branch.next), expected.defaultNext];
    expect(report!.steps.filter((step) => allTargets.includes(step.nodeId)).map((step) => step.nodeId)).toEqual([target]);
    evidence.push({ input: report!.run.input, version: report!.run.version, decision: decision.output, selectedStep: target });
    await expect(page.getByText("运行已完成", { exact: true })).toBeVisible();
  }
  await testInfo.attach("四次真实运行的条件证据", { body: JSON.stringify(evidence, null, 2), contentType: "application/json" });
  expect(pageErrors).toEqual([]);
});
