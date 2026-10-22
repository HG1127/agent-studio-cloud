import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { RunReportFile, RunSummary } from "../../src/contracts/run";
import { VersionExportFile } from "../../src/contracts/version";
import { EvaluationReviewNavigation, evaluationReviewHref } from "../../src/features/agents/evaluation-review-navigation";
import { evidenceStepLabel } from "../../src/features/workflow-canvas/execution-evidence";

function requireFixture(info: TestInfo) {
  const base = info.project.use.baseURL;
  const host = typeof base === "string" ? new URL(base).hostname : "";
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error("须由专用CI确认隔离数据库、本机服务与模拟模型；缺少前提不能回退生产或跳过");
  const readId = (name: string) => {
    const parsed = RunSummary.shape.id.safeParse(process.env[name]);
    if (!parsed.success) throw new Error(`须由专用CI准备真实已保存夹具：${name}；不能注入成功报告或跳过`);
    return parsed.data.toLowerCase();
  };
  return { agentId: readId("WORKFLOW_EVIDENCE_E2E_AGENT_ID"), runId: readId("WORKFLOW_EVIDENCE_E2E_RUN_ID"), evaluationRunId: readId("WORKFLOW_EVIDENCE_E2E_EVALUATION_RUN_ID"), batchId: readId("WORKFLOW_EVIDENCE_E2E_BATCH_ID"), caseId: readId("WORKFLOW_EVIDENCE_E2E_CASE_ID") };
}

async function reportSource(page: Page, agentId: string, runId: string, sourceType: "manual" | "evaluation") {
  const response = await page.request.get(`/api/runs/${runId}/export`);
  expect(response.ok()).toBe(true);
  const report = RunReportFile.parse(await response.json());
  expect(report.run.id.toLowerCase()).toBe(runId.toLowerCase()); expect(report.run.agentId.toLowerCase()).toBe(agentId.toLowerCase()); expect(report.run.sourceType).toBe(sourceType);
  if (!report.run.versionId || report.run.version === null || !["completed", "failed"].includes(report.run.status)) throw new Error("须准备已结束且关联真实冻结版本的任务，不使用未就绪记录伪造历史证据");
  const versionResponse = await page.request.get(`/api/agents/${agentId}/versions/${report.run.versionId}/export`);
  expect(versionResponse.ok()).toBe(true); const version = VersionExportFile.parse(await versionResponse.json());
  expect(version.manifest.workflowSnapshot.rootAgent.id.toLowerCase()).toBe(agentId.toLowerCase()); expect(version.version.number).toBe(report.run.version);
  if (version.manifest.resourceSelection?.model?.mock !== true) throw new Error("真实冻结版本必须保存模拟模型选择，进程标记不是安全证明");
  const safeTypes = new Set(["trigger", "end", "ai", "rule", "condition", "system"]);
  if (Object.values(version.manifest.workflowSnapshot.nodes).some((node) => !safeTypes.has(node.type))) throw new Error("此只读桌面夹具须为安全最小流程，不纳入业务工具、外部等待或助手协作");
  const step = report.steps.find((item) => {
    const node = version.manifest.workflowSnapshot.nodes[item.nodeId];
    return Object.prototype.hasOwnProperty.call(version.manifest.workflowSnapshot.nodes, item.nodeId) && node?.id === item.nodeId && !["trigger", "end"].includes(node.type);
  });
  if (!step) throw new Error("夹具没有可核对的真实顶层业务步骤；不能用空报告或猜测节点通过");
  return { report, step, version };
}

test("桌面近期任务步骤历史与真实验收报告定位只读，不覆盖本页填写", async ({ page }, info) => {
  test.setTimeout(180_000); await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = requireFixture(info);
  const manual = await reportSource(page, fixture.agentId, fixture.runId, "manual");
  const evaluation = await reportSource(page, fixture.agentId, fixture.evaluationRunId, "evaluation");
  const writes: string[] = []; const pageErrors: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`/agents/${fixture.agentId}`);
  const chooser = page.getByRole("combobox", { name: "定位流程步骤", exact: true });
  if (await chooser.locator(`option[value="${manual.step.nodeId}"]`).count() !== 1) throw new Error("当前工作台没有这份历史记录的唯一顶层步骤，不得自动替换其他步骤");
  await chooser.selectOption(manual.step.nodeId);
  await page.getByLabel("节点名称", { exact: true }).fill("尚未保存的历史核对标题");
  await page.getByText("核对所选步骤的历史执行证据", { exact: true }).click();
  const card = page.getByLabel("所选步骤的历史执行证据", { exact: true });
  const runChooser = card.getByRole("combobox", { name: "选择近期任务核对步骤", exact: true });
  await expect(runChooser).toHaveValue("");
  if (await runChooser.locator(`option[value="${fixture.runId}"]`).count() !== 1) throw new Error("真实任务不在本次近期清单，须由CI准备近期夹具，不能伪造选项或扩大为节点全历史");
  await runChooser.selectOption(fixture.runId);
  await expect(card.getByRole("region", { name: "历史步骤执行证据", exact: true })).toContainText(evidenceStepLabel(manual.step, 0));
  await expect(card.getByRole("link", { name: "打开这次运行的完整记录", exact: true })).toHaveAttribute("href", `/runs/${fixture.runId}`);
  await expect(page.getByLabel("节点名称", { exact: true })).toHaveValue("尚未保存的历史核对标题");
  await card.getByRole("button", { name: "重新读取所选任务报告", exact: true }).click();
  await expect(card.getByRole("region", { name: "历史步骤执行证据", exact: true })).toContainText("历史版本可能与当前草稿不同");
  expect(writes).toEqual([]);

  // 本页草稿明确放弃仅用于随后真实导航；没有提交或改动已保存流程。
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？", exact: true }).getByRole("button", { name: "放弃修改", exact: true }).click();
  if (await chooser.locator(`option[value="${evaluation.step.nodeId}"]`).count() !== 1) throw new Error("当前草稿缺少验收报告对应的唯一顶层步骤，不能猜测或替换目标");
  await chooser.selectOption(evaluation.step.nodeId);
  const currentEvaluationTitle = await page.getByLabel("节点名称", { exact: true }).inputValue();
  const review = EvaluationReviewNavigation.parse({ batchId: fixture.batchId, caseId: fixture.caseId, status: "all" });
  await page.goto(evaluationReviewHref(fixture.agentId, review));
  const dialog = page.getByRole("dialog", { name: /核对运行证据/ });
  await expect(dialog).toBeVisible();
  const href = await dialog.getByRole("link", { name: "打开运行详情", exact: true }).getAttribute("href");
  expect(new URL(href!, page.url()).pathname.toLowerCase()).toBe(`/runs/${fixture.evaluationRunId}`.toLowerCase());
  const records = dialog.getByRole("region", { name: "历史步骤执行证据", exact: true });
  await expect(records).toContainText(evidenceStepLabel(evaluation.step, evaluation.report.steps.indexOf(evaluation.step)));
  await expect(dialog.getByRole("region", { name: "已保存的样例判定", exact: true })).toBeVisible();
  const index = evaluation.report.steps.indexOf(evaluation.step);
  if (index >= 20) throw new Error("CI夹具须将要定位的顶层步骤放在报告第一页；不跳过实际定位验证");
  await records.getByRole("button", { name: "在当前草稿中查找此步骤", exact: true }).nth(index).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("节点名称", { exact: true })).toBeVisible();
  await expect(page.getByLabel("节点名称", { exact: true })).toHaveValue(currentEvaluationTitle);
  expect(await page.getByRole("combobox", { name: "定位流程步骤", exact: true }).locator(`option[value="${evaluation.step.nodeId}"]`).count()).toBe(1);
  expect(writes).toEqual([]); expect(pageErrors).toEqual([]);
  const unchanged = await page.request.get(`/api/runs/${fixture.runId}/export`);
  expect(unchanged.ok()).toBe(true); const after = RunReportFile.parse(await unchanged.json());
  expect(after.run).toEqual(manual.report.run); expect(after.steps).toEqual(manual.report.steps);
});
