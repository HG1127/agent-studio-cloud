import { expect, test } from "@playwright/test";
import { AgentExportFile, AgentSummary } from "../../src/contracts/agent";
import { RunListFilters, RunReportFile, RunSummary } from "../../src/contracts/run";
import { AttentionListState, attentionHref } from "../../src/features/runs/run-attention-url";
import { runsHref } from "../../src/features/runs/run-filter-url";

test("桌面真实助手卡片进入同助手待处理与运行记录，全程不写业务数据", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const agentIds = [process.env.AGENT_CARD_RUN_E2E_AGENT_ID, process.env.AGENT_CARD_RUN_E2E_OTHER_AGENT_ID].map((value) => AgentSummary.shape.id.safeParse(value));
  const runIds = [process.env.AGENT_CARD_RUN_E2E_RUN_ID, process.env.AGENT_CARD_RUN_E2E_OTHER_RUN_ID].map((value) => RunSummary.shape.id.safeParse(value));
  const base = testInfo.project.use.baseURL;
  const hostname = typeof base === "string" ? new URL(base).hostname : "";
  if (process.env.AGENT_CARD_RUN_E2E_ISOLATED !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(hostname) || agentIds.some((value) => !value.success) || runIds.some((value) => !value.success)) {
    throw new Error("CI须先外部证明本机验收服务的隔离数据库归属，再提供两不同在用助手及各自真实待确认或失败业务运行编号和 AGENT_CARD_RUN_E2E_ISOLATED=1。旗标不是隔离证明；缺条件不跳过，不创建运行或注入成功记录。");
  }
  const agents = agentIds.map((value) => { if (!value.success) throw new Error("Invalid fixture agent"); return value.data.toLowerCase(); });
  const runs = runIds.map((value) => { if (!value.success) throw new Error("Invalid fixture run"); return value.data.toLowerCase(); });
  if (agents[0] === agents[1] || runs[0] === runs[1]) throw new Error("隔离夹具必须是两个不同助手和两个不同真实任务。");
  const exports: AgentExportFile[] = [], reports: RunReportFile[] = [];
  for (let index = 0; index < agents.length; index++) {
    const exported = await page.request.get(`/api/agents/${agents[index]}/export`);
    expect(exported.ok()).toBe(true);
    exports.push(AgentExportFile.parse(await exported.json()));
    const reportResponse = await page.request.get(`/api/runs/${runs[index]}/export`);
    expect(reportResponse.ok()).toBe(true);
    const report = RunReportFile.parse(await reportResponse.json());
    expect(report.run.id.toLowerCase()).toBe(runs[index]);
    expect(report.run.agentId.toLowerCase()).toBe(agents[index]);
    if (report.run.agentArchived || report.run.sourceType === "evaluation" || !["waiting_approval", "failed"].includes(report.run.status)) {
      throw new Error("真实夹具须对应在用助手的已保存待确认或失败业务运行，不用验收任务或空页面冒充正向结果。");
    }
    expect(report.run.agentName).toBe(exports[index].agent.name);
    reports.push(report);
  }
  const names = exports.map((value) => value.agent.name);
  if (names[0] === names[1]) throw new Error("两个真实助手须有不同名称以核对范围归属。");
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });

  for (let index = 0; index < agents.length; index++) {
    const filters = RunListFilters.parse({ agentId: agents[index] });
    const attention = AttentionListState.parse(filters);
    await page.goto(`/agents?${new URLSearchParams({ q: names[index] })}`);
    await expect(page.getByRole("heading", { name: "我的助手", level: 1, exact: true })).toBeVisible();
    const card = page.getByRole("listitem").filter({ has: page.locator(`a[href="/agents/${agents[index]}"]`) });
    await expect(card).toHaveCount(1);
    const nav = card.getByRole("navigation", { name: names[index] + "的运行入口", exact: true });
    await expect(nav).toBeVisible();
    expect(await nav.evaluate((element) => element.closest("a") === null && element.querySelector("a a") === null)).toBe(true);
    await expect(nav.getByRole("link", { name: "查看待处理任务", exact: true })).toHaveAttribute("href", attentionHref(attention));
    await expect(nav.getByRole("link", { name: "查看运行记录", exact: true })).toHaveAttribute("href", runsHref(filters));
    await expect(card.getByRole("button", { name: "停用", exact: true })).toBeVisible();
    await expect(card.getByText(/没有待办|最近结果已读取/)).toHaveCount(0);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    const directoryUrl = page.url();
    await nav.getByRole("link", { name: "查看待处理任务", exact: true }).click();
    await expect(page).toHaveURL(new URL(attentionHref(attention), directoryUrl).href);
    await expect(page.getByRole("heading", { name: "待处理任务", level: 1, exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "助手", exact: true })).toHaveValue(agents[index]);
    await expect(page.locator(`a[href^="/runs/${runs[index]}?"]`)).toBeVisible();
    await expect(page.locator(`a[href^="/runs/${runs[1 - index]}?"]`)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(directoryUrl);
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "查看运行记录", exact: true }).click();
    await expect(page).toHaveURL(new URL(runsHref(filters), directoryUrl).href);
    await expect(page.getByRole("combobox", { name: "助手", exact: true })).toHaveValue(agents[index]);
    await expect(page.getByRole("combobox", { name: "运行状态", exact: true })).toHaveValue("");
    await expect(page.getByRole("combobox", { name: "发起方式", exact: true })).toHaveValue("");
    await expect(page.locator(`a[href^="/runs/${runs[index]}?"]`)).toBeVisible();
    await expect(page.locator(`a[href^="/runs/${runs[1 - index]}?"]`)).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(directoryUrl);
    await expect(nav).toBeVisible();
  }
  for (const [index, runId] of runs.entries()) {
    const response = await page.request.get(`/api/runs/${runId}/export`);
    expect(response.ok()).toBe(true);
    const after = RunReportFile.parse(await response.json());
    expect(after.run).toEqual(reports[index].run);
    expect(after.feedback).toEqual(reports[index].feedback);
    expect(after.approvals).toEqual(reports[index].approvals);
  }
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach("真实助手卡片运行范围只读导航", { body: JSON.stringify({ agentIds: agents, runIds: runs, widths: [1280, 1440], writes, errors, externalIsolationProofRequired: true, isolationVerifiedByThisSpec: false, createdOrMutatedFixture: false, cardClaimsPendingCount: false }, null, 2), contentType: "application/json" });
});
