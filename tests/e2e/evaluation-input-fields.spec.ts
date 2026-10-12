import { expect, test } from "@playwright/test";

const AGENT_ID = "79308fdc-0f53-4df3-aa99-61a1523609ff";

test("按真实版本业务字段创建验收样例并归档测试记录", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const caseName = `字段填写核对-${Date.now()}`;
  const item = page.locator("#evaluation").getByRole("listitem").filter({ hasText: caseName });

  try {
    await page.goto(`/agents/${AGENT_ID}#evaluation`);
    const evaluation = page.locator("#evaluation");
    await expect(evaluation.getByText("运行输入 · 版本 V1 的字段")).toBeVisible();
    await evaluation.getByLabel("样例名称").fill(caseName);
    await evaluation.getByRole("textbox", { name: "业务输入" }).fill("请整理客户回复邮件的验收样例");
    await evaluation.getByRole("button", { name: "添加样例" }).click();
    await expect(item).toBeVisible({ timeout: 60_000 });
    await item.getByText("查看样例内容").click();
    await expect(item).toContainText("请整理客户回复邮件的验收样例");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await page.goto(`/agents/${AGENT_ID}#evaluation`);
    await expect(page.locator("#evaluation").getByRole("heading", { name: "自动验收" })).toBeVisible();
    if (await item.isVisible()) {
      await item.getByRole("button", { name: "归档", exact: true }).click();
      await page.getByRole("dialog", { name: `归档「${caseName}」？` }).getByRole("button", { name: "归档样例" }).click();
      await expect(item).not.toBeVisible();
    }
  }
});
