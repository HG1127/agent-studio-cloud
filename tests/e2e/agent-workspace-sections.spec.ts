import { expect, test } from "@playwright/test";

test("助手工作台保留完整分区和分页地址，桌面与手机可查看真实内容", async ({ page }) => {
  await page.goto("/agents");
  const agentHref = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).find((href) => Boolean(href && /^\/agents\/[0-9a-f-]{36}$/.test(href))),
  );
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!);
  const latestLabel = await page.getByLabel("最近验收摘要").locator("p").first().textContent();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const url = `${agentHref}?versionsPage=2&archivedCasesPage=2&evaluationRunsPage=2`;
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "返回助手列表" })).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑名称和说明" })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "助手工作台分区" });
    for (const [name, href] of [["流程设计", "#workflow"], ["设计检查", "#audit"], ["版本发布", "#versions"], ["自动验收", "#evaluation"], ["试运行", "#run"]]) {
      await expect(navigation.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    }
    await expect(page.getByRole("heading", { level: 2, name: "流程设计", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "版本发布", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "自动验收", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "试运行", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /暂时无法读取/ })).toHaveCount(0);
    await expect(page.getByLabel("最近验收摘要").locator("p").first()).toHaveText(latestLabel!);
    const emptyVersionPage = page.locator("#versions").getByText("当前页没有版本记录", { exact: true });
    if (await emptyVersionPage.count()) {
      await expect(emptyVersionPage).toBeVisible();
      await expect(page.locator("#versions").getByText("还没有发布过版本", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "回到版本第一页" })).toHaveAttribute("href", "?versionsPage=1&archivedCasesPage=2&evaluationRunsPage=2#versions");
    }
    expect(new URL(page.url()).searchParams.get("versionsPage")).toBe("2");
    expect(new URL(page.url()).searchParams.get("archivedCasesPage")).toBe("2");
    expect(new URL(page.url()).searchParams.get("evaluationRunsPage")).toBe("2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `qa/agent-workspace-sections-${width === 390 ? "mobile" : "desktop"}.png`, fullPage: true });
  }
});
