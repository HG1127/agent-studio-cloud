import { expect, test } from "@playwright/test";

test("V5.7 信息架构可在工作台、验收和发布中心间导航", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "工作台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "助手", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "运行记录", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "知识库", exact: true })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26/dashboard-desktop.png" });
  }

  await page.getByRole("link", { name: "验收中心", exact: true }).click();
  await expect(page).toHaveURL(/\/acceptance$/);
  await expect(page.getByRole("link", { name: "验收中心", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "验收中心" })).toBeVisible();
  await expect(page.getByText("验收原则：")).toBeVisible();

  await page.getByRole("link", { name: "发布中心", exact: true }).click();
  await expect(page).toHaveURL(/\/releases$/);
  await expect(page.getByRole("link", { name: "发布中心", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "验收中心", exact: true })).not.toHaveAttribute("aria-current");
  await expect(page.getByRole("heading", { level: 1, name: "发布中心" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "发布状态与下一步" })).toBeVisible();
});

test("程序化地址变化同步更新侧栏与当前位置", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "总览" })).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => window.history.pushState(null, "", "/runs"));
  await expect(page).toHaveURL(/\/runs$/);
  await expect(page.getByRole("link", { name: "运行记录", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("运行中心");
  await expect(page.getByRole("link", { name: "总览" })).not.toHaveAttribute("aria-current");
});

test("工作台展示真实的最近助手并可继续进入工作台", async ({ page }) => {
  await page.goto("/");
  const recentAgents = page.getByRole("region", { name: "最近修改的助手" });
  await expect(recentAgents).toBeVisible();
  await expect(recentAgents.getByRole("link", { name: /查看全部助手/ })).toHaveAttribute("href", "/agents");
  const cards = recentAgents.getByRole("listitem");
  if (await cards.count()) {
    const firstAgent = cards.first().getByRole("link");
    await expect(firstAgent).toHaveAttribute("href", /^\/agents\/[0-9a-f-]{36}$/);
    await expect(firstAgent).toContainText(/个已保存版本|尚无已保存版本/);
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/dashboard-recent-agents-desktop.png", fullPage: true });
    await firstAgent.click();
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
  } else {
    await expect(recentAgents.getByText("还没有助手")).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(recentAgents).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/dashboard-recent-agents-mobile.png", fullPage: true });
});

test("验收到发布按真实状态提供搜索与下一步动作", async ({ page }) => {
  await page.goto("/acceptance");
  await expect(page.getByRole("heading", { level: 1, name: "验收中心" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "从设计到稳定运行" })).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toContainText("自动验收");
  await expect(page.getByRole("heading", { name: "待办与验收证据" })).toBeVisible();
  const firstAcceptanceCard = page.locator("main .content-card li").first();
  await expect(firstAcceptanceCard).toBeVisible();
  const firstName = (await firstAcceptanceCard.getByRole("heading", { level: 3 }).textContent())?.trim();
  expect(firstName).toBeTruthy();
  await expect(firstAcceptanceCard.getByRole("link")).toHaveAttribute("href", /#(?:evaluation|versions)$/);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-quality-flow/01-acceptance-desktop.png", fullPage: true });
  }

  await page.getByRole("search").getByRole("searchbox").fill(firstName!);
  await page.getByRole("search").getByRole("button", { name: "搜索" }).click();
  await expect(page).toHaveURL(/\/acceptance\?q=/);
  await expect(page.getByRole("heading", { level: 3, name: firstName!, exact: true })).toBeVisible();

  await page.goto("/releases");
  await expect(page.getByRole("heading", { level: 1, name: "发布中心" })).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toContainText("版本发布");
  await expect(page.getByRole("heading", { name: "发布状态与下一步" })).toBeVisible();
  const firstReleaseCard = page.locator("main .content-card li").first();
  await expect(firstReleaseCard).toBeVisible();
  await expect(firstReleaseCard.getByRole("link")).toHaveAttribute("href", /#(?:evaluation|versions)$/);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-quality-flow/02-releases-desktop.png", fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/acceptance");
  await expect(page.locator('[aria-current="step"]')).toContainText("自动验收");
  const acceptanceOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > window.innerWidth + 1 || rect.left < -1
        ? [{ tag: element.tagName, classes: typeof element.className === "string" ? element.className : "", left: Math.round(rect.left), right: Math.round(rect.right), text: (element.textContent ?? "").trim().slice(0, 80) }]
        : [];
    }).slice(0, 12),
  }));
  expect(acceptanceOverflow.offenders, JSON.stringify(acceptanceOverflow)).toEqual([]);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-quality-flow/03-acceptance-mobile.png", fullPage: true });
  }

  await page.goto("/releases");
  await expect(page.locator('[aria-current="step"]')).toContainText("版本发布");
  const releaseOverflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      return rect.right > window.innerWidth + 1 || rect.left < -1
        ? [{ tag: element.tagName, classes: typeof element.className === "string" ? element.className : "", left: Math.round(rect.left), right: Math.round(rect.right), text: (element.textContent ?? "").trim().slice(0, 80) }]
        : [];
    }).slice(0, 12),
  }));
  expect(releaseOverflow.offenders, JSON.stringify(releaseOverflow)).toEqual([]);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-quality-flow/04-releases-mobile.png", fullPage: true });
  }
});

test("手机端使用抽屉导航且页面不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "工作台" })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26/dashboard-mobile.png" });
  }
  await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
  await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26/shell-mobile-drawer.png" });
  }
  await expect(page.getByRole("dialog").getByRole("link", { name: "助手", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: "运行记录", exact: true }).click();
  await expect(page).toHaveURL(/\/runs$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("服务状态区分需要检查与明确不可用", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "工作台" })).toBeVisible();

  const shellHealth = page.getByRole("link", { name: /云端运行服务：/ });
  await expect(shellHealth).toBeVisible();
  await expect(shellHealth).not.toContainText("暂不可用");
  await shellHealth.click();
  await expect(page).toHaveURL(/\/#system-health$/);

  const systemHealth = page.locator("#system-health");
  await expect(systemHealth).toBeVisible();
  await expect(systemHealth.getByRole("button", { name: "重新检查" })).toBeVisible();
  await expect(systemHealth).not.toContainText("异常");
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-resilience/02-final-dashboard-health.png", fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "打开导航" }).click();
  const mobileHealth = page.getByRole("dialog").getByRole("link", { name: /云端运行服务：(需要检查|正常|状态未知)/ });
  await expect(mobileHealth).toBeVisible();
  await expect(mobileHealth).not.toContainText("暂不可用");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-resilience/03-final-mobile-health.png" });
  }
});

test("长连接加载态先解释等待再进入工作台", async ({ page }) => {
  await page.goto(`/?loadingAudit=${Date.now()}`, { waitUntil: "commit" });
  await expect(page.getByText("正在读取工作区最新状态")).toBeVisible();
  await expect(page.getByText(/首次连接可能需要一点时间/)).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-resilience/04-final-dashboard-loading.png", fullPage: true });
  }
  await expect(page.getByRole("heading", { level: 1, name: "工作台" })).toBeVisible();
});

test("创建助手会引导填写目标并在手机端保持完整可用", async ({ page }) => {
  await page.goto("/agents/new");
  const createSection = page.getByRole("main");

  await expect(createSection.getByRole("heading", { name: "创建新助手" })).toBeVisible();
  await createSection.getByLabel("助手名称").fill("客户投诉处理助手");
  await createSection.getByRole("button", { name: /示例 1/ }).click();
  await expect(createSection.getByLabel(/想让助手完成什么/)).toHaveValue(/收到客户投诉后/);
  await expect(createSection.getByText("已经可以创建")).toBeVisible();

  await createSection.locator("summary").click();
  await expect(createSection.getByLabel("什么时候开始")).toBeVisible();
  await expect(createSection.getByLabel("最终要交付什么")).toBeVisible();

  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26/agents-create-desktop-section.png" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(createSection.getByRole("button", { name: "创建助手" })).toBeVisible();

  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26/agents-create-mobile-section.png" });
  }
});

test("流程工作台在桌面与手机端都能查看并编辑节点", async ({ page }) => {
  await page.goto("/agents");
  const agentHref = await page.locator('main a[href^="/agents/"]:not([href="/agents/new"])').first().getAttribute("href");
  expect(agentHref).toBeTruthy();
  await page.goto(agentHref!);
  await expect(page.getByRole("heading", { level: 2, name: "流程设计" })).toBeVisible();
  await expect(page.getByText(/点击画布中的步骤/)).toBeVisible();

  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workflow/01-workspace-desktop.png" });
  }

  await page.locator(".react-flow__node").nth(1).click();
  await expect(page.getByRole("complementary", { name: "节点详情" })).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭节点详情" })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workflow/02-node-inspector-desktop.png" });
  }
  await page.getByRole("complementary", { name: "节点详情" }).getByRole("button", { name: "关闭节点详情" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("button", { name: "步骤列表" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("按顺序查看；点任一步骤即可打开详细设置。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workflow/03-workspace-mobile-steps.png" });
  }

  await page.getByRole("button", { name: "流程画布" }).click();
  await expect(page.locator(".react-flow")).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workflow/03b-workspace-mobile-canvas.png" });
  }
  await page.getByRole("button", { name: "步骤列表" }).click();

  await page.locator("ol button").nth(1).click();
  const mobileInspector = page.getByRole("complementary", { name: "节点详情" });
  await expect(mobileInspector).toBeVisible();
  const inspectorBox = await mobileInspector.boundingBox();
  expect(inspectorBox?.width ?? 0).toBeGreaterThan(320);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workflow/04-node-inspector-mobile.png" });
  }
});

test("版本发布与自动验收在工作台形成连续路径", async ({ page }) => {
  await page.goto("/acceptance");
  await expect(page.getByRole("heading", { level: 1, name: "验收中心" })).toBeVisible();
  const firstReadyLink = page.getByRole("link", { name: "开始首次验收" }).first();
  const fallbackLink = page.locator('main .content-card a[href$="#evaluation"]').first();
  const targetHref = await firstReadyLink.count()
    ? await firstReadyLink.getAttribute("href")
    : await fallbackLink.getAttribute("href");
  expect(targetHref).toBeTruthy();

  await page.goto(targetHref!);
  const versions = page.locator("#versions");
  const evaluation = page.locator("#evaluation");
  await expect(versions.getByRole("heading", { name: "版本历史" })).toBeVisible();
  await expect(evaluation.getByRole("heading", { name: "自动验收" })).toBeVisible();
  await expect(evaluation.getByRole("button", { name: /运行全部样例|检查并继续/ })).toBeVisible();

  if (process.env.CAPTURE_WORKSPACE_BASELINE) {
    await versions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/00-baseline-versions-desktop.png" });
    await evaluation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/01-baseline-evaluation-desktop.png" });
  }
  if (process.env.CAPTURE_UI_AUDIT) {
    await versions.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/02-versions-desktop.png" });
    await evaluation.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/03-evaluation-desktop.png" });
    await evaluation.screenshot({ path: "qa/audit-2026-09-26-workspace-release/03b-evaluation-desktop-full.png" });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await versions.evaluate((element) => element.scrollIntoView({ block: "start" }));
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/04-versions-mobile.png" });
    await versions.screenshot({ path: "qa/audit-2026-09-26-workspace-release/04b-versions-mobile-full.png" });
  }
  await evaluation.evaluate((element) => element.scrollIntoView({ block: "start" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_WORKSPACE_BASELINE) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/01b-baseline-evaluation-mobile.png" });
  }
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-workspace-release/05-evaluation-mobile.png" });
    await evaluation.screenshot({ path: "qa/audit-2026-09-26-workspace-release/05b-evaluation-mobile-full.png" });
  }
  const archiveButton = evaluation.getByRole("button", { name: "归档" }).first();
  await archiveButton.scrollIntoViewIfNeeded();
  const archiveBox = await archiveButton.boundingBox();
  expect((archiveBox?.x ?? 0) + (archiveBox?.width ?? 0)).toBeLessThanOrEqual(390);
});

test("详情不存在时提供对象相关的安全返回路径", async ({ page }) => {
  const missingId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  await page.goto(`/runs/${missingId}`);
  await expect(page.getByRole("heading", { name: "没有找到这条运行记录" })).toBeVisible();
  await expect(page.getByText(/系统不会自动重跑任务/)).toBeVisible();
  await expect(page.getByRole("link", { name: "返回运行记录" })).toHaveAttribute("href", "/runs");
  await expect(page.getByRole("link", { name: "查看助手" })).toHaveCount(0);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-detail-recovery/02-final-run-not-found.png", fullPage: true });
  }

  await page.goto(`/agents/${missingId}`);
  await expect(page.getByRole("heading", { name: "没有找到这个助手" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回助手列表" })).toHaveAttribute("href", "/agents");
  await expect(page.getByRole("link", { name: "创建新助手" })).toHaveAttribute("href", "/agents/new");
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-detail-recovery/03-final-agent-not-found.png", fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/runs/${missingId}`);
  await expect(page.getByRole("heading", { name: "没有找到这条运行记录" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT) {
    await page.screenshot({ path: "qa/audit-2026-09-26-detail-recovery/04-final-run-not-found-mobile.png", fullPage: true });
  }
});
