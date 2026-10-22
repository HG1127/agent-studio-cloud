import { createServer } from "node:http";
import { config } from "dotenv";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

config({ path: ".env.local" });

test("手机端导航按整项换行，表单不横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const links = page.getByRole("navigation").getByRole("link");
  for (const link of await links.all()) {
    const dimensions = await link.evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
    }));
    expect(dimensions.height).toBeLessThanOrEqual(dimensions.lineHeight + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("模型连接页可从导航进入，空表单不能提交", async ({ page }) => {
  await page.goto("/agents");
  const navigation = page.getByRole("navigation", { name: "主导航" });
  await navigation.getByRole("button", { name: "资料与应用", exact: true }).click();
  await navigation.getByRole("link", { name: "模型连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "模型连接", exact: true })).toBeVisible();
  for (const label of ["连接名称", "服务地址", "密钥", "模型列表"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "保存连接", exact: true })).toBeDisabled();
});

test("连接增改测删与发布选模可贯通，运行保留模型名和用量", async ({ page }) => {
  test.skip(!process.env.MODEL_ENCRYPTION_KEY, "完整连接测试需要在测试服务进程配置加密主钥");
  test.setTimeout(240_000);
  const name = `连接验收-${Date.now()}`;
  const renamed = `${name}-编辑`;
  const fakeKey = "sk-e2e-not-real-1234";
  const requests: Array<{ model: string; authorization: string | undefined; isProbe: boolean }> = [];
  let rejectRequests = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ model: body.model, authorization: request.headers.authorization, isProbe: JSON.stringify(body.messages ?? []).includes("连通性测试助手") });
    response.setHeader("content-type", "application/json");
    if (rejectRequests) {
      response.writeHead(401).end(JSON.stringify({ error: { message: `invalid ${fakeKey}` } }));
      return;
    }
    response.end(JSON.stringify({
      id: "local-test-reply", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: "本地协议验收输出" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地测试服务没有监听端口");
  const sql = postgres(process.env.DATABASE_URL_POOLED!, { prepare: false, max: 1 });
  try {
    await page.goto("/settings");
    await page.getByLabel("连接名称", { exact: true }).fill(name);
    await page.getByLabel("服务地址", { exact: true }).fill(`http://127.0.0.1:${address.port}/v1`);
    await page.getByLabel("密钥", { exact: true }).fill(fakeKey);
    await page.getByLabel("模型列表", { exact: true }).fill("first-model，selected-model:latest");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    let row = page.getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("****1234");
    await expect(page.getByLabel("密钥", { exact: true })).toHaveValue("");
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("密钥", { exact: true })).toHaveValue("");
    await page.getByLabel("连接名称", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    row = page.getByRole("listitem").filter({ hasText: renamed });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("连接正常", { timeout: 30_000 });
    expect(requests[0]).toMatchObject({ model: "first-model", authorization: `Bearer ${fakeKey}`, isProbe: true });

    rejectRequests = true;
    await row.getByRole("button", { name: "测试连接", exact: true }).click();
    const connectionError = page.getByRole("main").getByRole("alert");
    await expect(connectionError).toContainText("测试失败", { timeout: 30_000 });
    await expect(connectionError).not.toContainText(fakeKey);
    rejectRequests = false;

    await page.goto("/agents");
    await page.getByLabel("助手名称").fill(name);
    await page.getByLabel("想让助手完成什么（至少 10 个字）").fill("收到客户咨询后生成回复方案，最后输出回复邮件");
    await page.getByRole("button", { name: "创建助手", exact: true }).click();
    await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
    await page.getByRole("combobox", { name: "运行模型" }).selectOption({ label: `${renamed} / selected-model:latest` });
    await page.getByRole("button", { name: "发布新版本", exact: true }).click();
    await expect(page.getByText("当前版本", { exact: true })).toBeVisible({ timeout: 30_000 });
    requests.length = 0;
    await page.getByLabel("业务输入（必填）").fill("验证已选择的模型连接");
    await page.getByRole("button", { name: "运行此助手", exact: true }).click();
    await page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 60_000 });
    await expect(page.locator("header").getByText("已完成", { exact: true })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/本地协议验收输出/).first()).toBeVisible();
    const runRequests = requests.filter((request) => !request.isProbe);
    expect(runRequests.length).toBeGreaterThan(0);
    expect(runRequests.map((request) => request.model)).toEqual(Array(runRequests.length).fill("selected-model:latest"));
    const runId = page.url().split("/").pop()!;
    const outputs = await sql`select output from run_steps where run_id = ${runId} and node_type = 'ai'`;
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.every((row) => row.output.usage.inputTokens === 12 && row.output.usage.outputTokens === 6)).toBe(true);
    const modelData = page.locator("details").filter({ hasText: '"inputTokens": 12' }).first();
    await modelData.getByText("查看执行记录与步骤产出").click();
    await modelData.getByText("查看步骤数据（开发者数据）").click();
    await expect(modelData.locator("pre")).toBeVisible();
    await expect(modelData.locator("pre")).toContainText('"outputTokens": 6');

    await page.goto("/settings");
    row = page.getByRole("listitem").filter({ hasText: renamed });
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await expect(row.getByText(/已发布版本将无法运行/)).toBeVisible();
    await row.getByRole("button", { name: "取消", exact: true }).click();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "删除", exact: true }).click();
    await row.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(row).toHaveCount(0, { timeout: 30_000 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await sql`delete from model_connections where name in (${name}, ${renamed}) and api_key_hint = '****1234'`;
    await sql.end();
  }
});
