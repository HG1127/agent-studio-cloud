import { config } from "dotenv";
import { expect, test } from "@playwright/test";

config({ path: ".env.local" });

// M3 关键路径：知识上传→检索全链路 + 定时任务→tick 开跑。
// 知识检索是关键词匹配：检索词取流程步骤文本（如「读取资料生成回复方案」），
// 所以 fixture 里必须原样包含这句话，否则零命中防护会让运行失败（这是设计行为）。
test("上传知识文档到已就绪并跑通知识检索全链路", async ({ page }) => {
  const agentName = `M3 知识链路助手-${Date.now()}`;
  await page.goto("/knowledge");
  await page.setInputFiles('input[type="file"]', "tests/fixtures/m3-knowledge-sample.txt");
  await page.getByRole("button", { name: "上传文档" }).click();
  await expect(page.getByText(/m3-knowledge-sample/).first()).toBeVisible();
  await expect(page.getByText("已就绪").first()).toBeVisible({ timeout: 30_000 });

  await page.goto("/agents");
  await page.getByLabel("助手名称").fill(agentName);
  await page
    .getByLabel("想让助手完成什么（至少 10 个字）")
    .fill("收到客户咨询后读取资料生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("当前版本", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "运行此助手" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.locator("header").getByText("等待确认", { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator("header").getByText("已完成", { exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/已从知识库找到/)).toBeVisible();
});

test("创建定时任务并经 tick 接口开出定时运行", async ({ page, request }) => {
  test.setTimeout(300_000);
  const agentName = `M3 定时链路助手-${Date.now()}`;
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
  await page.getByLabel("运行输入（JSON）").fill('{"input": "定时演示运行"}');
  await page.getByRole("button", { name: "创建定时任务" }).click();
  // 不能用 getByText(agentName).first()：表单下拉的 <option> 同名且在 DOM 前面，会被判 hidden
  await expect(page.locator("li").filter({ hasText: agentName })).toBeVisible({ timeout: 15_000 });

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
  await expect(page.getByText("定时", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
});
