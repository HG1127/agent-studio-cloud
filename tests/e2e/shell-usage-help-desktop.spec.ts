import { expect, test } from "@playwright/test";

test("桌面真实全局帮助可打开、键盘关闭并保留未提交填写，不调用写接口", async ({ page }, testInfo) => {
  const base = testInfo.project.use.baseURL;
  if (typeof base !== "string" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("帮助原生规格仅允许CI核对的本机服务，不转到远端环境");
  const writes: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/agents/new");
  await page.getByLabel("助手名称", { exact: true }).fill("帮助核对的本地填写");
  const trigger = page.getByRole("button", { name: "打开使用帮助", exact: true });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "使用帮助", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "选择助手 → 填写资料 → 查看结果", exact: true })).toBeVisible();
    await expect(dialog).toContainText("不会保存设置、启动或取消任务");
    await expect(page).toHaveURL(/\/agents\/new$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByLabel("助手名称", { exact: true })).toHaveValue("帮助核对的本地填写");
  }
  await trigger.click();
  await page.getByRole("dialog", { name: "使用帮助", exact: true }).getByRole("button", { name: "关闭使用帮助", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(writes).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("桌面帮助提供真实准备与结果入口，选择后关闭窗口，不把指引当业务状态", async ({ page }, testInfo) => {
  const base = testInfo.project.use.baseURL;
  if (typeof base !== "string" || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("帮助原生规格仅允许CI核对的本机服务");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents/new");
  const destinations = [
    ["找到需要使用的助手", "/agents"], ["创建与完善助手", "/agents/new"],
    ["准备公司资料", "/knowledge"], ["配置模型连接", "/settings"],
    ["查看结果与反馈", "/runs"], ["检查运行服务", "/#system-health"],
    ["核对外部工具", "/connections"], ["查看待处理任务", "/runs/attention"],
  ];
  await page.getByRole("button", { name: "打开使用帮助", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "使用帮助", exact: true });
  for (const [name, href] of destinations) await expect(dialog.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
  await dialog.getByRole("link", { name: "查看结果与反馈", exact: true }).click();
  await expect(page).toHaveURL(/\/runs$/);
  await expect(page.getByRole("dialog", { name: "使用帮助", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("处理记录");
  await page.getByRole("button", { name: "打开使用帮助", exact: true }).click();
  await page.getByRole("dialog", { name: "使用帮助", exact: true }).getByRole("link", { name: "检查运行服务", exact: true }).click();
  await expect(page).toHaveURL(/\/#system-health$/);
  await expect(page.locator("#system-health")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "使用帮助", exact: true })).toHaveCount(0);
});
