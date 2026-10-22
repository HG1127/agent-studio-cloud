import { expect, test } from "@playwright/test";

const AGENT_ID = "79308fdc-0f53-4df3-aa99-61a1523609ff";

test("验收字段检查在桌面双栏和手机端不被遮挡", async ({ page }) => {
  await page.goto("/agents");
  const agentHref = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).find((href) => Boolean(href && /^\/agents\/[0-9a-f-]{36}$/.test(href))),
  );
  test.skip(!agentHref, "当前工作区没有可查看的助手");

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${agentHref}#evaluation`, { waitUntil: "domcontentloaded" });
    const evaluation = page.locator("#evaluation");
    await expect(evaluation.getByRole("heading", { name: "自动验收" })).toBeVisible();
    const checks = evaluation.locator("details").filter({ hasText: "字段检查（" });
    await expect(checks).toHaveCount(1, { timeout: 10_000 });
    if (!(await checks.evaluate((element: HTMLDetailsElement) => element.open))) await checks.locator("summary").click();
    const add = checks.getByRole("button", { name: "添加字段检查" });
    await expect(add).toBeVisible({ timeout: 10_000 });
    test.skip(!(await add.isEnabled()), "验收期间或等待核对，无法编辑字段检查");
    await add.click();
    const path = evaluation.getByRole("textbox", { name: "字段检查 1 路径" });
    await path.fill("deliverables.plan");
    await evaluation.getByRole("combobox", { name: "字段检查 1 方式" }).selectOption("equals");
    const value = evaluation.getByRole("textbox", { name: "字段检查 1 预期值" });
    await value.fill("已完成");
    for (const control of [path, value, evaluation.getByRole("button", { name: "删除检查" })]) {
      await control.scrollIntoViewIfNeeded();
      const hit = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest("details")?.getBoundingClientRect();
        const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { left: rect.left, right: rect.right, panelLeft: panel?.left, panelRight: panel?.right, hit: target === element || element.contains(target) };
      });
      expect(hit.left, JSON.stringify(hit)).toBeGreaterThanOrEqual(hit.panelLeft! - 1);
      expect(hit.right, JSON.stringify(hit)).toBeLessThanOrEqual(hit.panelRight! + 1);
      expect(hit.hit, JSON.stringify(hit)).toBe(true);
    }
    await evaluation.getByRole("button", { name: "删除检查" }).click();
    await expect(path).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("真实验收样例在手机端归档前说明影响，取消不写入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/agents/${AGENT_ID}#evaluation`);
  const evaluation = page.locator("#evaluation");
  await expect(evaluation.getByRole("heading", { name: "自动验收" })).toBeVisible();
  await expect(evaluation.getByText("运行输入 · 版本 V1 的字段")).toBeVisible();
  const businessInput = evaluation.getByRole("textbox", { name: "业务输入" });
  await businessInput.fill("用于核对字段的测试文字");
  await evaluation.getByRole("button", { name: "使用对象格式" }).click();
  await expect(evaluation.getByLabel("运行输入")).toHaveValue('{\n  "input": "用于核对字段的测试文字"\n}');
  await evaluation.getByRole("button", { name: "按版本字段填写" }).click();
  await expect(businessInput).toHaveValue("用于核对字段的测试文字");
  await businessInput.clear();
  if (process.env.CAPTURE_EVALUATION_AUDIT === "1") {
    await businessInput.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/evaluation-input-mobile.png" });
  }
  const archive = evaluation.getByRole("button", { name: "归档", exact: true }).first();
  test.skip(!(await archive.isVisible()), "这个助手没有启用中的验收样例");

  const sample = evaluation.getByRole("listitem", { name: /验收样例：/ }).first();
  await sample.getByText("查看样例内容").click();
  await expect(sample.getByText("业务输入", { exact: true })).toBeVisible();
  await expect(sample).not.toContainText('{"input"');
  if (process.env.CAPTURE_EVALUATION_AUDIT === "1") await sample.screenshot({ path: "qa/evaluation-sample-preview-mobile.png" });

  await archive.click();
  const confirmation = page.getByRole("dialog", { name: /^归档「.+」？$/ });
  await expect(confirmation).toContainText("不再参与后续自动验收");
  await expect(confirmation).toContainText("可以从已归档样例中恢复");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_EVALUATION_AUDIT === "1") await page.screenshot({ path: "qa/evaluation-archive-mobile.png" });
  await confirmation.getByRole("button", { name: "关闭确认弹窗" }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(archive).toBeVisible();
});
