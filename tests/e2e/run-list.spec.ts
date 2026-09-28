import { expect, test } from "@playwright/test";

const AUDIT_DIR = "qa/audit-2026-09-27-run-list";

test("运行中心按任务优先级进入真实筛选并在手机端保持可用", async ({ page }) => {
  await page.goto("/runs");
  await expect(page.getByRole("heading", { name: "运行中心" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "按任务优先级查看" })).toBeVisible();
  await expect(page.getByRole("link", { name: /等你处理/ })).toHaveAttribute("href", "/runs?status=waiting_approval");
  await expect(page.getByRole("link", { name: /需要处理/ })).toHaveAttribute("href", "/runs?status=failed");
  await expect(page.getByText(/本页 \d+ 条/)).toBeVisible();
  const currentUrl = page.url();
  await page.getByRole("button", { name: "重新读取列表" }).click();
  await expect(page).toHaveURL(currentUrl);
  await expect(page.getByRole("heading", { name: "运行中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新读取列表" })).toBeEnabled();

  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: `${AUDIT_DIR}/02-final-desktop.png`, fullPage: true });
  }

  await page.getByRole("link", { name: /需要处理/ }).click();
  await expect(page).toHaveURL(/\/runs\?status=failed$/);
  await expect(page.getByRole("heading", { name: "筛选结果" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("当前范围：失败");
  await expect(page.getByLabel("运行状态")).toHaveValue("failed");
  await expect(page.getByRole("link", { name: /需要处理/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/runs");

  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: `${AUDIT_DIR}/03-final-filtered.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/runs");
  await expect(page.getByRole("heading", { name: "运行中心" })).toBeVisible();
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  await expect(page.getByRole("form", { name: "筛选运行记录" })).toBeVisible();
  await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();

  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: `${AUDIT_DIR}/04-final-mobile.png`, fullPage: true });
    await page.screenshot({ path: `${AUDIT_DIR}/05-final-mobile-top.png` });
  }
});

test("运行状态快捷入口保留发起方式及可选的助手范围", async ({ page }) => {
  await page.goto("/runs", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "运行中心" })).toBeVisible();
  const agentOptions = page.getByLabel("助手", { exact: true }).locator('option:not([value=""])');
  const agent = await agentOptions.count() > 0 ? await agentOptions.first().getAttribute("value") : null;
  if (agent) await page.getByLabel("助手", { exact: true }).selectOption(agent);
  await page.getByLabel("发起方式").selectOption("manual");
  await page.getByRole("button", { name: "应用筛选" }).click();
  if (agent) await expect(page.getByLabel("助手", { exact: true })).toHaveValue(agent);
  await expect(page.getByLabel("发起方式")).toHaveValue("manual");
  await expect(page.getByRole("link", { name: /需要处理/ })).toHaveAttribute("href", `/runs?status=failed&source=manual${agent ? `&agent=${agent}` : ""}`);
  await page.getByRole("link", { name: /需要处理/ }).click();
  await expect(page.getByLabel("运行状态")).toHaveValue("failed");
  if (agent) await expect(page.getByLabel("助手", { exact: true })).toHaveValue(agent);
  await expect(page.getByRole("link", { name: /查看当前范围的全部状态/ })).toHaveAttribute("href", `/runs?source=manual${agent ? `&agent=${agent}` : ""}`);
});

test("翻到空页时如实提示并保留筛选返回第一页", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/runs?status=failed&page=987");
  await expect(page.getByRole("heading", { name: "当前页没有运行记录" })).toBeVisible();
  await expect(page.getByRole("link", { name: /回到第一页/ })).toHaveAttribute("href", "/runs?status=failed");
  await expect(page.getByRole("link", { name: "上一页" })).toHaveAttribute("href", "/runs?status=failed&page=986");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_RUN_EMPTY === "1") await page.screenshot({ path: "qa/run-empty-page-mobile.png", fullPage: true });
  await page.getByRole("link", { name: /回到第一页/ }).click();
  await expect(page).toHaveURL(/\/runs\?status=failed$/);
  await expect(page.getByLabel("运行状态")).toHaveValue("failed");
});

test("从状态筛选进入真实运行后返回原筛选范围", async ({ page }) => {
  await page.goto("/runs");
  const firstRun = page.locator("main .content-card ul li").first();
  test.skip((await firstRun.count()) === 0, "当前工作区没有运行记录");
  const text = await firstRun.innerText();
  const statuses = [
    ["等待确认", "waiting_approval"], ["等待继续", "waiting_event"], ["排队中", "queued"],
    ["运行中", "running"], ["已完成", "completed"], ["失败", "failed"], ["已取消", "cancelled"],
  ] as const;
  const selected = statuses.find(([label]) => text.includes(label));
  expect(selected).toBeDefined();
  await page.getByLabel("运行状态").selectOption(selected![1]);
  await page.getByRole("button", { name: "应用筛选" }).click();
  const filteredRun = page.locator("main .content-card ul li a[href^='/runs/']").first();
  await expect(filteredRun).toBeVisible();
  await expect(filteredRun).toHaveAttribute("href", /\?from=/);
  await filteredRun.click();
  const back = page.getByRole("link", { name: "返回筛选结果" });
  await expect(back).toHaveAttribute("href", `/runs?status=${selected![1]}`);
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/runs\\?status=${selected![1]}$`));
  await expect(page.getByLabel("运行状态")).toHaveValue(selected![1]);
});
