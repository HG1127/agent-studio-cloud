import { expect, test } from "@playwright/test";

const AUDIT_DIR = "qa/audit-2026-09-27-knowledge";

test("资料页按真实状态展示上传、检索和可恢复归档", async ({ page }) => {
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { level: 1, name: "资料与应用" })).toBeVisible();
  const categories = page.getByRole("navigation", { name: "资料与应用分类" });
  await expect(categories.getByRole("link", { name: /业务工具/ })).toHaveAttribute("href", "#business-tools");
  await expect(categories.getByRole("link", { name: /公司资料/ })).toHaveAttribute("href", "#knowledge-sources");
  await expect(categories.getByRole("link", { name: /模型连接/ })).toHaveAttribute("href", "/settings");
  const catalog = page.getByRole("region", { name: "业务工具目录" });
  await expect(catalog).toBeVisible();
  await expect(catalog.getByText(/登记不代表连接已验证或已获授权/)).toBeVisible();
  const toolCount = Number((await catalog.getByText(/已登记 \d+ 项/).first().innerText()).match(/\d+/)?.[0]);
  if (toolCount === 0) {
    await expect(catalog.getByText("当前没有已登记的业务工具")).toBeVisible();
  } else {
    await expect(catalog.getByRole("listitem")).toHaveCount(toolCount);
    await catalog.getByRole("searchbox", { name: "搜索业务工具" }).fill("这项工具肯定不存在-20260928");
    await expect(catalog.getByText("没有符合条件的工具。请调整关键词或风险筛选。")).toBeVisible();
    await catalog.getByRole("searchbox", { name: "搜索业务工具" }).clear();
    await expect(catalog.getByRole("listitem")).toHaveCount(toolCount);
  }
  await expect(page.getByRole("heading", { name: "上传业务资料" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "验证资料检索" })).toBeVisible();
  await expect(page.getByText(/不等于某位助手的运行结果/)).toBeVisible();
  await expect(page.getByRole("link", { name: "前往助手核对资料范围" })).toHaveAttribute("href", "/agents");
  await expect(page.getByRole("link", { name: "查看模型连接" })).toHaveAttribute("href", "/settings");
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/01-desktop.png`, fullPage: true });

  const archive = page.getByRole("button", { name: "归档", exact: true }).first();
  if (await archive.count()) {
    await archive.click();
    const dialog = page.getByRole("dialog", { name: "归档这份资料？" });
    await expect(dialog.getByText(/归档后不再参与助手检索/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认归档" })).toBeVisible();
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/02-archive-confirmation.png`, fullPage: true });
    await dialog.getByRole("button", { name: "返回" }).click();
    await expect(dialog).toBeHidden();
  }

  await page.getByRole("searchbox", { name: "按文件名查找资料" }).fill("这份资料肯定不存在-20260927");
  await page.getByRole("button", { name: "查找", exact: true }).click();
  await expect(page.getByText(/没有找到匹配的资料/)).toBeVisible();
  await expect(page.getByRole("link", { name: "清除查找" })).toBeVisible();
  const preview = page.getByRole("region", { name: "验证资料检索" });
  await preview.getByRole("textbox", { name: "检索关键词" }).fill(`肯定不存在的业务词-${Date.now()}`);
  await preview.getByRole("button", { name: "开始检索" }).click();
  await expect(preview.getByRole("status")).toContainText("没有找到相关内容");
  await expect(preview.getByText(/不等于某位助手的运行结果/)).toBeVisible();
  if (process.env.CAPTURE_KNOWLEDGE_SCOPE === "1") await preview.screenshot({ path: "qa/knowledge-search-scope-desktop.png" });
});

test("资料页手机端不横向溢出，操作仍可到达", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/knowledge");
  await expect(page.getByRole("heading", { level: 1, name: "资料与应用" })).toBeVisible();
  await expect(page.getByRole("region", { name: "业务工具目录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传文档" })).toBeVisible();
  if (process.env.CAPTURE_KNOWLEDGE_SCOPE === "1") await page.getByRole("region", { name: "验证资料检索" }).screenshot({ path: "qa/knowledge-search-scope-mobile.png" });
  const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `${AUDIT_DIR}/03-mobile.png`, fullPage: true });
});
