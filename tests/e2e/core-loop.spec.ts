import { expect, test } from "@playwright/test";

// 关键用户路径：创建 → 画布 → 发布 → 运行 → 审批 → 结果 → 反馈 → 回归验收。
// 固定走 mock 模型与规则编排（webServer env），断言确定性中文文案；
// 运行数据残留可接受，助手名带时间戳后缀防重。
test("创建助手到审批完成的完整闭环", async ({ page }) => {
  test.setTimeout(360_000);
  const agentName = `客服测试助手-${Date.now()}`;

  // ① 创建：名称 + 意图 → 跳转详情，画布出现人工确认节点
  await page.goto("/agents/new");
  await page.getByLabel("助手名称").fill(agentName);
  // 意图里故意不写「读取资料」类字眼：M3 起知识步骤真检索，零命中会让运行失败，
  // 而 M2 闭环用例只验证创建→发布→运行→审批链路，不依赖知识来源。
  await page
    .getByLabel("想让助手完成什么（至少 10 个字）")
    .fill("收到客户咨询后生成回复方案，发送前由负责人确认，最后输出回复邮件");
  await page.getByRole("button", { name: "创建助手" }).click();
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: agentName })).toBeVisible();
  await expect(page.locator('[data-testid^="rf__node-"]').getByText("负责人确认发送内容", { exact: true }))
    .toBeVisible({ timeout: 30_000 });

  // ② 发布：版本面板出现「版本 1」与「当前版本」标记
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("版本 1", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible({ timeout: 30_000 });

  // ③ 运行：跳转 run 详情，挂起在人工节点——等待确认徽标与审批面板经 SSE 自动出现（实测约 35-40 秒）
  await page.getByLabel("业务输入（必填）").fill("请生成一份客户回复方案");
  await page.getByRole("button", { name: "开始试运行" }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "确认后才能继续" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByRole("heading", { name: "该步骤正在等待确认" })).toBeVisible();

  // ④ 批准：恢复重放到终态（实测约 30-45 秒），轨迹含流程完成与模型步骤条目
  await page.getByRole("button", { name: "批准并继续" }).click();
  await expect(page.getByRole("heading", { name: "结果与执行证据已保存" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("流程执行完成")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/步骤「[^」]+」完成/).first()).toBeVisible({ timeout: 90_000 });

  // ⑤ 改进闭环：提交具体差评，把本次真实输入加入验收样例，再回到助手页继续编辑检查条件
  await page.getByRole("button", { name: /需要改进/ }).click();
  await page.getByLabel("结果反馈说明").fill("结果需要补充客户回复依据");
  await page.getByRole("button", { name: "保存改进意见" }).click();
  await expect(page.getByRole("status")).toContainText("已记录改进意见");
  await page.getByRole("button", { name: "加入验收样例", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已加入验收样例", { timeout: 30_000 });
  await page.getByRole("link", { name: "前往补充结果检查" }).click();
  await expect(page).toHaveURL(/\/agents\/[0-9a-f-]+#evaluation$/);
  await expect(page.getByText(`改进回归：${agentName}`)).toBeVisible({ timeout: 30_000 });

  // ⑥ 已有真实回归样例时重新发布为候选版本；从验收总览打开并取消整轮验收，不额外启动运行。
  await page.getByRole("button", { name: "发布新版本" }).click();
  await expect(page.getByText("候选版本 2 等待自动验收")).toBeVisible({ timeout: 30_000 });
  await page.goto("/acceptance");
  await page.getByRole("searchbox", { name: "搜索助手" }).fill(agentName);
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("heading", { name: agentName })).toBeVisible();
  await page.getByRole("button", { name: "验收全部样例" }).click();
  const confirmation = page.getByRole("dialog", { name: "运行全部验收样例？" });
  await expect(confirmation).toContainText(agentName);
  await expect(confirmation).toContainText("可能自动上线");
  await confirmation.getByRole("button", { name: "返回" }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByRole("button", { name: "验收全部样例" })).toBeEnabled();
});
