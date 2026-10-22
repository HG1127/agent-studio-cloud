import { expect, test, type TestInfo } from "@playwright/test";
import { VersionExportFile, VersionSummary } from "../../src/contracts/version";
import { RunReportFile } from "../../src/contracts/run";

function requireIsolatedPolicyWindow(info: TestInfo) {
  const base = info.project.use.baseURL;
  const url = typeof base === "string" ? new URL(base) : null;
  if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port === "3210"
    || process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1"
    || process.env.HARNESS_POLICY_E2E_EXCLUSIVE_WORKSPACE !== "1") {
    throw new Error("须由专用CI证明隔离数据库归属、独占空规则工作区、允许智能处理的管理员规则和演示模型；使用非3210独立验收服务，不跳过、不改生产。标记本身不是隔离证明。");
  }
}

test("桌面真实规则读取、明确保存、新任务被规则拦截、刷新后明确清除", async ({ page }, info) => {
  test.setTimeout(300000); requireIsolatedPolicyWindow(info);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/harness");
  const panel = page.locator("#workspace-safety-policy");
  await expect(panel.getByText("尚未设置工作区附加规则", { exact: true })).toBeVisible();
  const policyWrites: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/harness") policyWrites.push(request.method()); });
  await panel.getByRole("button", { name: "添加安全规则", exact: true }).click();
  const rule = panel.getByRole("group", { name: "安全规则 1", exact: true });
  await rule.getByLabel("步骤类型", { exact: true }).selectOption("ai");
  await rule.getByLabel("规则说明（选填）", { exact: true }).fill("隔离验收阻止智能处理");
  await panel.getByLabel("安全规则修改原因", { exact: true }).fill("核对新运行在实际模型调用前被工作区规则拦截");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(rule.getByLabel("步骤类型", { exact: true })).toHaveValue("ai");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await panel.getByRole("button", { name: "核对并保存安全规则", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "确认保存安全规则", exact: true });
  await expect(confirm).toBeVisible(); expect(policyWrites).toHaveLength(0);
  await confirm.getByRole("button", { name: "确认提交这次修改", exact: true }).click();
  await expect(panel.getByText(/这次请求已保存为第 1 版/)).toBeVisible({ timeout: 60000 });
  expect(policyWrites).toHaveLength(1);
  await page.reload();
  await expect(panel.getByText("已保存 1 条附加规则 · 第 1 版", { exact: true })).toBeVisible();
  await expect(panel.getByRole("group", { name: "安全规则 1", exact: true }).getByLabel("步骤类型", { exact: true })).toHaveValue("ai");
  await expect(panel.getByRole("group", { name: "安全规则 1", exact: true }).getByLabel("规则说明（选填）", { exact: true })).toHaveValue("隔离验收阻止智能处理");

  await page.goto("/agents/new");
  await page.getByLabel("助手名称", { exact: true }).fill("安全规则原生核对-" + Date.now());
  await page.getByLabel("想让助手完成什么（至少 10 个字）", { exact: true }).fill("根据客户邮件正文整理重点，生成一份邮件回复草稿，不发送任何外部消息");
  await page.getByRole("button", { name: "创建助手", exact: true }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/i, { timeout: 60000 });
  const agentPath = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  const exportHref = await page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true }).getAttribute("href");
  if (!exportHref) throw new Error("真实正式版本没有可读取来源，不能继续启动");
  const exportMatch = exportHref.match(/^\/api\/agents\/([0-9a-f-]{36})\/versions\/([0-9a-f-]{36})\/export$/i);
  const selectedAgentId = VersionSummary.shape.id.parse(exportMatch?.[1]);
  const selectedVersionId = VersionSummary.shape.id.parse(exportMatch?.[2]);
  expect(selectedAgentId.toLowerCase()).toBe(VersionSummary.shape.id.parse(agentPath.split("/").at(-1)).toLowerCase());
  const versionReply = await page.request.get(exportHref); expect(versionReply.ok()).toBe(true);
  const version = VersionExportFile.parse(await versionReply.json());
  expect(version.version.status).toBe("production");
  expect(version.manifest.resourceSelection.model.mock).toBe(true);
  expect(version.manifest.resourceSelection.model.connectionId).toBeNull();
  const nodes = Object.values(version.manifest.workflowSnapshot.nodes);
  const safeFlatTypes = new Set(["trigger", "end", "ai", "human", "condition", "rule"]);
  if (nodes.some((node) => !safeFlatTypes.has(node.type) || node.tool || node.agentCall || node.toAgent || node.subflow || node.parallel || node.loop)
    || !nodes.some((node) => node.type === "ai")) throw new Error("隔离生成的真实流程必须有智能处理，且无外部工具、助手调用或嵌套流程；不猜测嵌套安全性、不用假流程替代");
  const launcher = page.locator("#run");
  for (const [index, field] of version.manifest.inputContract.fields.entries()) {
    const control = launcher.getByLabel(`${field.label?.trim() || `业务信息 ${index + 1}`}（${field.required ? "必填" : "选填"}）`, { exact: true });
    if (field.type === "boolean") await control.selectOption("false");
    else await control.fill(field.type === "number" ? "0" : field.type === "object" ? '{"说明":"隔离验收"}' : field.type === "array" ? '["隔离验收"]' : "请整理客户邮件并生成回复草稿，不执行外部业务动作。");
  }
  if (version.manifest.inputContract.fields.length === 0) throw new Error("真实启动约定未提供业务字段，不能用默认空输入冒充关键路径");
  await launcher.getByRole("button", { name: "开始试运行", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/i, { timeout: 60000 });
  const runPath = new URL(page.url()).pathname;
  await expect.poll(async () => {
    const reply = await page.request.get("/api" + runPath + "/export");
    if (!reply.ok()) return "读取失败";
    return RunReportFile.parse(await reply.json()).run.status;
  }, { timeout: 120000, message: "核对真实任务最终被规则拦截；创建回执不是执行完成" }).toBe("failed");
  const reply = await page.request.get("/api" + runPath + "/export"); expect(reply.ok()).toBe(true);
  const blocked = RunReportFile.parse(await reply.json());
  expect(blocked.run.agentId).toBe(agentPath.split("/").at(-1));
  expect(blocked.run.versionId).toBe(selectedVersionId);
  expect(blocked.trace.some((event) => event.kind === "harness.policy" && event.level === "warn" && event.title.includes("被运行策略阻止"))).toBe(true);
  expect(blocked.steps.some((step) => step.nodeType === "ai" && step.status === "failed" && step.error?.includes("运行策略禁止执行这一步"))).toBe(true);

  await page.goto("/harness?run=" + runPath.split("/").at(-1));
  await expect(page.getByText(/被运行策略阻止/).first()).toBeVisible();
  const realAiStep = blocked.steps.find((step) => step.nodeType === "ai");
  if (!realAiStep) throw new Error("没有实际受检智能步骤，不能用自拟条件替代真实草稿命中核对");
  await panel.getByLabel("试算步骤类型", { exact: true }).selectOption("ai");
  await panel.getByText("试算技术条件（开发者）", { exact: true }).click();
  await panel.getByLabel("试算 nodeId", { exact: true }).fill(realAiStep.nodeId);
  await panel.getByRole("button", { name: "核对草稿命中结果", exact: true }).click();
  await expect(panel.getByText("本组条件被阻止", { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(/命中当前填写的工作区第 1 条规则/)).toBeVisible();
  await expect(panel.getByText("已保存 1 条附加规则 · 第 1 版", { exact: true })).toBeVisible();
  await panel.getByLabel("安全规则修改原因", { exact: true }).fill("清除隔离验收工作区附加规则，原任务保持原执行结果");
  await panel.getByRole("button", { name: "清除工作区规则", exact: true }).click();
  const clear = page.getByRole("dialog", { name: "确认清除工作区规则", exact: true });
  await expect(clear).toContainText("不会解除管理员规则、工具权限或已冻结任务的限制");
  await clear.getByRole("button", { name: "确认提交这次修改", exact: true }).click();
  await expect(panel.getByText(/这次请求已保存为第 2 版/)).toBeVisible({ timeout: 60000 });
  await page.reload();
  await expect(panel.getByText("工作区附加规则已清除 · 第 2 版", { exact: true })).toBeVisible();
  const finalReply = await page.request.get("/api" + runPath + "/export"); expect(finalReply.ok()).toBe(true);
  const unchanged = RunReportFile.parse(await finalReply.json());
  expect(unchanged.run.status).toBe("failed");
  expect(unchanged.trace.filter((event) => event.kind === "harness.policy")).toEqual(blocked.trace.filter((event) => event.kind === "harness.policy"));
  expect(unchanged.steps.filter((step) => step.nodeType === "ai")).toEqual(blocked.steps.filter((step) => step.nodeType === "ai"));
  await info.attach("真实规则操作与运行检查", { body: JSON.stringify({ savedAndReloaded: true, newRunBlockedBeforeModel: true, clearedAndReloaded: true, earlierTaskUnchanged: true, historicalFrozenRevisionExposed: false }), contentType: "application/json" });
});
