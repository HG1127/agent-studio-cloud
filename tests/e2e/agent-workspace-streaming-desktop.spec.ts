import { expect, test } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";

test("桌面工作台分区重读保留同一助手未保存草稿且不发起写操作", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/agents?" + new URLSearchParams({ q: "客服测试助手-" }));
  await expect(page.getByRole("heading", { name: "我的助手", level: 1 })).toBeVisible();
  await expect(page.locator('main a[href^="/agents/"]').filter({ hasText: /客服测试助手-\d+/ }).first()).toBeVisible();
  const candidates = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) => elements
    .map((element) => ({ href: element.getAttribute("href"), stamp: Number(element.textContent?.match(/客服测试助手-(\d+)/)?.[1]) }))
    .filter((item) => item.href && /^\/agents\/[0-9a-f-]{36}$/.test(item.href) && Number.isFinite(item.stamp))
    .sort((left, right) => right.stamp - left.stamp));
  expect(candidates.length, "使用实际创建闭环产生的验收助手，不构造页面数据").toBeGreaterThan(0);
  const href = candidates[0].href!;
  const beforeResponse = await page.request.get("/api" + href + "/export");
  expect(beforeResponse.ok()).toBe(true);
  const before = AgentExportFile.parse(await beforeResponse.json());
  const ai = Object.values(before.workflow.nodes).find((node) => node.type === "ai");
  expect(ai).toBeDefined();
  const query = new URLSearchParams({ versionsPage: "2", archivedCasesPage: "2", evaluationRunsPage: "2" });
  await page.goto(href + "?" + query, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: before.agent.name, level: 1 })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "助手工作台分区" });
  for (const [name, target] of [["流程设计", "#workflow"], ["设计检查", "#audit"], ["版本发布", "#versions"], ["自动验收", "#evaluation"], ["试运行", "#run"]]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toHaveAttribute("href", target);
  }
  const locate = page.getByRole("combobox", { name: "定位流程步骤", exact: true });
  await expect(locate).toBeVisible();
  await expect(page.locator("#versions").getByRole("link", { name: "回到版本第一页", exact: true })).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "qa/agent-workspace-streaming-desktop.png" });
  }
  await locate.selectOption(ai!.id);
  const inspector = page.getByRole("complementary", { name: "节点详情" });
  await expect(inspector.getByLabel("节点名称", { exact: true })).toHaveValue(ai!.title);
  const temporaryTitle = ai!.title + "（桌面临时核对）";
  await inspector.getByLabel("节点名称", { exact: true }).fill(temporaryTitle);
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
  const prompts: string[] = [];
  page.on("dialog", async (dialog) => { prompts.push(dialog.message()); await dialog.accept(); });
  await page.locator("#versions").getByRole("link", { name: "回到版本第一页", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(href + "\\?versionsPage=1&archivedCasesPage=2&evaluationRunsPage=2#versions$"));
  await expect(page.locator("#versions").getByRole("link", { name: "回到版本第一页", exact: true })).toHaveCount(0);
  await expect(locate).toHaveValue("");
  await expect(locate.locator(`option[value="${ai!.id}"]`)).toContainText(temporaryTitle);
  await expect(inspector.getByLabel("节点名称", { exact: true })).toHaveValue(temporaryTitle);
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
  const afterResponse = await page.request.get("/api" + href + "/export");
  expect(afterResponse.ok()).toBe(true);
  const after = AgentExportFile.parse(await afterResponse.json());
  expect(after.workflow).toEqual(before.workflow);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
  for (const message of prompts) expect(message).toBe("页面还有未保存修改，确定离开当前页面吗？");
  await testInfo.attach("同助手分区重读保留本地草稿", { body: JSON.stringify({ assistantPath: href, writes, prompts, savedDefinitionUnchanged: true }), contentType: "application/json" });
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.locator("#workflow").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/agent-workspace-draft-preserved-desktop.png" });
  }
});
