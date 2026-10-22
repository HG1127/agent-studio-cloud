import { expect, test } from "@playwright/test";
import { ToolRegistryOption } from "../../src/contracts/tool-registry";

test("桌面查看真实登记的完整字段约定与原定义，不发起业务写入", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/connections");
  const catalog = page.getByRole("region", { name: "业务工具目录" });
  await expect(catalog).toBeVisible();
  const first = catalog.getByRole("listitem").first();
  await expect(first).toBeVisible();
  const name = await first.getByRole("heading", { level: 3 }).innerText();
  await first.getByText("查看" + name + "的详情", { exact: true }).click();
  const definition = first.getByRole("region", { name: name + "的完整登记定义" });
  await expect(definition).toBeVisible();
  await expect(definition).toContainText("不证明已获授权、调用成功或可以安全重发");
  await expect(definition.getByRole("region", { name: "输入字段约定" })).toBeVisible();
  await expect(definition.getByRole("region", { name: "结果字段约定" })).toBeVisible();
  await definition.getByText("开发者完整登记原定义（只读）", { exact: true }).click();
  const original = definition.getByRole("textbox", { name: name + "的登记原定义" });
  await expect(original).toHaveAttribute("readonly");
  const raw = JSON.parse(await original.inputValue());
  const validated = ToolRegistryOption.safeParse(raw);
  expect(validated.success).toBe(true);
  if (!validated.success) throw new Error("真实登记定义未通过共享结构核对");
  expect(raw.name).toBe(name);
  expect(raw).not.toHaveProperty("endpoint");
  expect(raw).not.toHaveProperty("headers");
  expect(Object.hasOwn(raw, "inputSchema")).toBe(true);
  expect(Object.hasOwn(raw, "outputSchema")).toBe(true);
  expect(typeof raw.action).toBe("string");
  expect(typeof raw.scope).toBe("string");
  await expect(definition).toContainText(raw.operationKind === "read" ? "已声明为读取" : raw.operationKind === "action" ? "已声明可能改变外部业务数据" : "未登记读写分类");
  await expect(definition).toContainText(raw.businessIdempotency === true ? "已声明支持按业务键核对重复请求" : raw.businessIdempotency === false ? "已明确未声明按业务键核对重复请求" : "未提供业务重复请求声明");
  const originalText = await original.inputValue();
  await definition.getByText("开发者完整登记原定义（只读）", { exact: true }).click();
  await expect(original).toHaveCount(0);
  await definition.getByText("开发者完整登记原定义（只读）", { exact: true }).click();
  await expect(original).toHaveValue(originalText);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
  await testInfo.attach("真实完整登记定义读取边界", { body: JSON.stringify({ inspected: true, inputRulePresent: true, outputRulePresent: true, writes }), contentType: "application/json" });
});

test("桌面外部工具连接按真实登记清单筛选和只读刷新，不冒充协议连接", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/connections");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "外部工具连接", level: 1 })).toBeVisible();
  const boundary = page.getByRole("region", { name: "连接与工具不是同一件事" });
  for (const name of ["连接与握手", "发现与复核", "授权与运行"]) {
    await expect(boundary.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(boundary).toContainText("不证明工具已通过连通或授权检查");
  await expect(boundary).toContainText("当前页面不收集密钥");
  await expect(main.getByRole("button", { name: /测试连接|添加连接|授权/ })).toHaveCount(0);
  const catalog = page.getByRole("region", { name: "业务工具目录" });
  const countLabel = await catalog.getByText(/^已登记 \d+ 项$/).innerText();
  const registeredCount = Number(countLabel.match(/\d+/)![0]);
  await expect(catalog.getByRole("listitem")).toHaveCount(registeredCount);
  if (registeredCount === 0) {
    await expect(catalog.getByText("当前没有已登记的业务工具", { exact: true })).toBeVisible();
    await expect(catalog.getByRole("searchbox")).toHaveCount(0);
  } else {
    const firstName = await catalog.getByRole("listitem").first().getByRole("heading", { level: 3 }).innerText();
    const search = catalog.getByRole("searchbox", { name: "搜索业务工具" });
    await search.fill(firstName);
    await expect(catalog.getByRole("listitem").first()).toContainText(firstName);
    await search.fill("没有这项已登记业务工具");
    await expect(catalog.getByRole("status")).toHaveText(`当前显示 0 / ${registeredCount} 项已登记工具`);
    await expect(catalog.getByText("没有符合条件的工具。请调整关键词或风险筛选。", { exact: true })).toBeVisible();
    await search.fill("");
    await catalog.getByRole("button", { name: "高风险", exact: true }).click();
    await expect(catalog.getByRole("button", { name: "高风险", exact: true })).toHaveAttribute("aria-pressed", "true");
    for (const item of await catalog.getByRole("listitem").all()) {
      await expect(item).toContainText("高风险");
      await expect(item).toContainText("连接状态未在此处验证");
    }
    await catalog.getByRole("button", { name: "全部风险", exact: true }).click();
    await expect(catalog.getByRole("listitem")).toHaveCount(registeredCount);
  }
  const reread = page.waitForResponse((response) => new URL(response.url()).pathname === "/connections"
    && response.request().method() === "GET" && response.request().headers()["rsc"] === "1");
  const refresh = main.getByRole("button", { name: "重新读取状态", exact: true });
  await refresh.click();
  expect((await reread).ok()).toBe(true);
  await expect(refresh).toBeEnabled();
  await expect(catalog.getByRole("listitem")).toHaveCount(registeredCount);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
  await testInfo.attach("外部连接桌面真实登记与只读操作", { body: JSON.stringify({ registeredCount, writes }), contentType: "application/json" });
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/external-connections-desktop.png", fullPage: true });
});
