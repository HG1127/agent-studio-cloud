import { expect, test } from "@playwright/test";

test("创建助手前可核对完整说明，超限时不能误提交", async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/agents/new", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "把一项工作交给 AI" })).toBeVisible();
    await page.getByRole("textbox", { name: "助手名称" }).fill("售后助手");
    const objective = page.getByRole("textbox", { name: /想让助手完成什么/ });
    await objective.fill("工".repeat(1995));
    await page.getByText("补充业务蓝图（推荐）").click();
    await page.getByRole("textbox", { name: "什么时候开始" }).fill("收到新工单后");
    await expect(page.getByText(/完整工作说明超出 \d+ 个字/)).toBeVisible();
    await expect(page.getByText("完整说明过长，暂不能创建")).toBeVisible();
    await expect(page.getByRole("button", { name: "创建助手" })).toBeDisabled();
    await page.getByText("核对完整工作说明").click();
    await expect(page.getByText(/触发条件：收到新工单后/)).toBeVisible();
    await expect(page.getByText(/不是已生成的流程/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await objective.fill("收到新工单后整理资料并生成处理建议");
    await expect(page.getByText("已经可以创建")).toBeVisible();
    await expect(page.getByRole("button", { name: "创建助手" })).toBeEnabled();
    await page.getByRole("button", { name: "清空内容" }).click();
    await page.getByRole("dialog", { name: "清空当前内容？" }).getByRole("button", { name: "确认清空" }).click();
  }
});
