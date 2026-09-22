import { expect, test } from "@playwright/test";

// 关键用户路径：创建 → 画布 → 发布 → 运行 → 审批 → 结果。
// 固定走 mock 模型（webServer env MODEL_MOCK=1），断言确定性中文文案；
// 运行数据残留可接受，助手名带时间戳后缀防重。
test("创建助手到审批完成的完整闭环", async ({ page }) => {
  const agentName = `客服测试助手-${Date.now()}`;

  // ① 创建：名称 + 意图 → 跳转详情，画布出现人工确认节点
  await page.goto("/agents");
  await page.getByLabel("助手名称").fill(agentName);
  await page
    .getByLabel("想让助手完成什么（至少 10 个字）")
    .fill("收到客户咨询后读取客户资料并生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: agentName })).toBeVisible();
  await expect(page.getByText("负责人确认发送内容")).toBeVisible({ timeout: 30_000 });

  // ② 发布：版本面板出现「版本 1」与「当前版本」标记
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("版本 1", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("当前版本", { exact: true })).toBeVisible({ timeout: 30_000 });

  // ③ 运行：跳转 run 详情，挂起在人工节点——等待确认徽标与审批面板经 SSE 自动出现（实测约 35-40 秒）
  await page.getByRole("button", { name: "运行此助手" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.locator("header").getByText("等待确认", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("该步骤正在等待确认")).toBeVisible({ timeout: 90_000 });

  // ④ 批准：恢复重放到终态（实测约 30-45 秒），轨迹含流程完成与模型步骤条目
  await page.getByRole("button", { name: "批准", exact: true }).click();
  await expect(page.locator("header").getByText("已完成", { exact: true })).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText("流程执行完成")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/步骤「[^」]+」完成/).first()).toBeVisible({ timeout: 90_000 });
});
