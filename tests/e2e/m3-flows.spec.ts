import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { config } from "dotenv";
import { expect, test } from "@playwright/test";

config({ path: ".env.local" });

test("上传知识文档到已就绪并跑通知识检索全链路", async ({ page }) => {
  const sampleId = randomUUID();
  const agentName = `M3 知识链路助手-${sampleId}`;
  const filename = `m3-knowledge-sample-${sampleId}.txt`;
  const query = `读取资料生成回复方案${sampleId}`;
  const fixture = await readFile("tests/fixtures/m3-knowledge-sample.txt");
  // 唯一检索词同时避免内容去重与历史资料命中。
  const buffer = Buffer.concat([Buffer.from(`${query}\n`), fixture]);
  await page.goto("/knowledge");
  await page.setInputFiles('input[type="file"]', { name: filename, mimeType: "text/plain", buffer });
  const uploaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/knowledge/sources" && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "上传文档" }).click();
  const response = await uploaded;
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true, deduped: false, source: { name: filename } });
  const source = page.getByRole("listitem").filter({ has: page.getByText(filename, { exact: true }) });
  await expect(source).toContainText("已就绪", { timeout: 60_000 });
  await expect(source).toHaveCount(1);

  await page.goto("/agents");
  await page.getByLabel("助手名称").fill(agentName);
  await page
    .getByLabel("想让助手完成什么（至少 10 个字）")
    .fill(`收到客户咨询后${query}，发送前由负责人确认，最后输出回复邮件`);
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("当前版本", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "运行此助手" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.locator("header").getByText("等待确认", { exact: true })).toBeVisible({ timeout: 90_000 });
  const approval = page.locator("section").filter({ has: page.getByRole("heading", { name: "该步骤正在等待确认" }) });
  await expect(approval.getByText("待确认草稿")).toBeVisible();
  await expect(approval.getByText(/\[模拟输出\]/)).toBeVisible();
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator("header").getByText("已完成", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/已从知识库找到/)).toBeVisible();
  const steps = page.locator("section").filter({ has: page.getByRole("heading", { name: "执行步骤", exact: true }) });
  const receipt = steps.locator("details").filter({ hasText: filename });
  await expect(receipt).toHaveCount(1);
  await receipt.getByText("查看步骤数据（开发者数据）", { exact: true }).click();
  await expect(receipt.locator("pre")).toBeVisible();
  expect(JSON.parse(await receipt.locator("pre").innerText())).toMatchObject({
    ok: true,
    query,
    hits: expect.arrayContaining([expect.objectContaining({ source: filename, excerpt: expect.stringContaining(query) })]),
  });
});

test("创建定时任务并经 tick 接口开出定时运行", async ({ page, request }) => {
  test.setTimeout(300_000);
  const sampleId = randomUUID();
  const agentName = `M3 定时链路助手-${sampleId}`;
  const input = { input: `定时演示运行-${sampleId}` };
  await page.goto("/agents");
  await page.getByLabel("助手名称").fill(agentName);
  await page
    .getByLabel("想让助手完成什么（至少 10 个字）")
    .fill("收到客户咨询后生成回复方案，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("当前版本", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto("/schedules");
  await page.getByLabel("助手").selectOption({ label: agentName });
  await page.getByLabel("频率类型").selectOption({ label: "执行一次" });
  // 执行一次 + 约 90 秒后：本地等价于 tick 兜底，等到点后调一次 tick 接口
  const due = new Date(Date.now() + 90_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  const local = `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}T${pad(due.getHours())}:${pad(due.getMinutes())}`;
  await page.getByLabel("执行时间").fill(local);
  await page.getByLabel("运行输入（JSON）").fill(JSON.stringify(input));
  await page.getByRole("button", { name: "创建定时任务" }).click();
  const schedule = page.getByRole("listitem").filter({ has: page.getByText(agentName, { exact: true }) });
  await expect(schedule).toBeVisible({ timeout: 15_000 });

  await page.goto("/runs");
  const scheduledRun = page.getByRole("listitem").filter({ has: page.getByText(agentName, { exact: true }) });
  await expect(scheduledRun).toHaveCount(0);
  while (Date.now() < due.getTime() + 2_000) {
    await page.waitForTimeout(1_000);
  }
  const secret = process.env.CRON_SECRET;
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3210";
  const tick = await request.post(`${base}/api/schedules/tick`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
  expect(tick.ok()).toBeTruthy();
  await page.goto("/runs");
  await expect(scheduledRun).toHaveCount(1, { timeout: 30_000 });
  await expect(scheduledRun.getByText("定时", { exact: true })).toBeVisible();
  await scheduledRun.getByRole("link").click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible();
  const runInput = page.locator("section").filter({ has: page.getByRole("heading", { name: "运行输入", exact: true }) });
  expect(JSON.parse(await runInput.locator("pre").innerText())).toEqual(input);
  await expect(page.locator("header").getByText("已完成", { exact: true })).toBeVisible({ timeout: 90_000 });
});
