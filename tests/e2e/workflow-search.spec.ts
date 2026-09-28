import { expect, test } from "@playwright/test";

const AGENT_ID = "79308fdc-0f53-4df3-aa99-61a1523609ff";

for (const [name, width, height] of [["手机", 390, 844], ["桌面", 1440, 900]] as const) {
  test(`真实流程在${name}端按名称查找并定位步骤`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/agents/${AGENT_ID}#workflow`);
    const workflow = page.locator("#workflow");
    await expect(workflow.getByRole("heading", { name: "流程设计" })).toBeVisible();
    await workflow.getByRole("textbox", { name: "搜索流程步骤" }).fill("输出回复邮件");
    const locator = workflow.getByRole("combobox", { name: "定位流程步骤" });
    await expect(locator).toContainText("1 个步骤");
    const matchingOption = locator.locator("option").filter({ hasText: "输出回复邮件" });
    const nodeId = await matchingOption.getAttribute("value");
    expect(nodeId).toBeTruthy();
    await locator.selectOption(nodeId!);
    await expect(workflow.getByRole("heading", { name: "节点详情" })).toBeVisible();
    await expect(workflow.getByLabel("节点名称")).toHaveValue("输出回复邮件");
    await expect(workflow.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    if (name === "桌面") {
      await expect(workflow.locator('[data-testid^="rf__node-"]').filter({ hasText: "输出回复邮件" })).toHaveClass(/selected/);
      await page.waitForTimeout(400);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.CAPTURE_WORKFLOW_SEARCH === "1") await page.screenshot({ path: `qa/workflow-search-${name === "手机" ? "mobile" : "desktop"}.png` });
  });
}
