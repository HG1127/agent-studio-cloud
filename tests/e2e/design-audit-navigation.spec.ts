import { expect, test } from "@playwright/test";

test("设计问题从真实审计记录定位到对应流程步骤", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const agentName = `定位核对助手-${Date.now()}`;
  let created = false;

  try {
    await page.goto("/agents/new");
    await page.getByLabel("助手名称").fill(agentName);
    await page.getByLabel("想让助手完成什么（至少 10 个字）").fill("收到客户咨询后整理回复方案，交给负责人确认，再输出一份回复邮件");
    await page.getByRole("button", { name: "创建助手" }).click();
    await page.waitForURL(/\/agents\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    created = true;
    await expect(page.getByRole("heading", { level: 1, name: agentName })).toBeVisible();

    await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("ai");
    await page.getByRole("button", { name: "添加", exact: true }).click();
    await expect(page.getByLabel("节点名称")).toHaveValue("新增智能处理");
    await page.getByRole("button", { name: "关闭节点详情" }).last().click();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator("#workflow").getByRole("status").filter({ hasText: "草稿已保存" })).toBeVisible({ timeout: 60_000 });

    const audit = page.locator("#audit");
    await expect(audit).not.toContainText("businessSpec");
    await expect(audit).toContainText("业务规格");
    const issue = audit.getByRole("listitem").filter({ hasText: "存在无法到达的步骤" }).first();
    await expect(issue).toBeVisible({ timeout: 60_000 });
    if (process.env.CAPTURE_AUDIT_NAVIGATION === "1") await audit.screenshot({ path: "qa/design-audit-list-mobile.png" });
    await issue.getByRole("button", { name: "在流程中查看" }).click();
    await expect(page.getByRole("heading", { name: "节点详情" })).toBeVisible();
    await expect(page.getByLabel("节点名称")).toHaveValue("新增智能处理");
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.CAPTURE_AUDIT_NAVIGATION === "1") await page.screenshot({ path: "qa/design-audit-navigation-mobile.png" });
  } finally {
    if (created) {
      await page.goto(`/agents?q=${encodeURIComponent(agentName)}`);
      const item = page.getByRole("region", { name: "在用助手" }).getByRole("listitem").filter({ hasText: agentName });
      await expect(item).toBeVisible();
      await item.getByRole("button", { name: "停用" }).click();
      await page.getByRole("dialog", { name: `停用「${agentName}」？` }).getByRole("button", { name: "确认停用" }).click();
      await expect(item).not.toBeVisible();
    }
  }
});
