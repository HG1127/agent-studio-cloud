import { expect, test } from "@playwright/test";

test("步骤组与条件规则在窄侧栏内可编辑且可删除", async ({ page }) => {
  await page.goto("/agents");
  const agentHref = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).find((href) => Boolean(href && /^\/agents\/[0-9a-f-]{36}$/.test(href))),
  );
  test.skip(!agentHref, "当前工作区没有可查看的助手");

  async function expectInsideInspector(control: ReturnType<typeof page.getByRole>) {
    await control.scrollIntoViewIfNeeded();
    const bounds = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const inspector = element.closest('aside[aria-label="节点详情"]')?.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { left: rect.left, right: rect.right, inspectorLeft: inspector?.left, inspectorRight: inspector?.right, hit: hit === element || element.contains(hit) };
    });
    expect(bounds.left, JSON.stringify(bounds)).toBeGreaterThanOrEqual(bounds.inspectorLeft! - 1);
    expect(bounds.right, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.inspectorRight! + 1);
    expect(bounds.hit, JSON.stringify(bounds)).toBe(true);
  }

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${agentHref}#workflow`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
    const addType = page.getByRole("combobox", { name: "新增步骤类型" });
    await addType.selectOption("subflow");
    const add = page.getByRole("button", { name: "添加", exact: true });
    test.skip(!(await add.isEnabled()), "当前流程已达到步骤上限");
    await add.click();
    const inspector = page.getByRole("complementary", { name: "节点详情" });
    await expect(inspector).toBeVisible();
    await inspector.getByRole("button", { name: "添加步骤" }).click();
    const stepName = inspector.getByRole("textbox", { name: "步骤组步骤 2 名称" });
    await expectInsideInspector(stepName);
    await stepName.fill("核对资料");
    await inspector.getByRole("combobox", { name: "步骤组步骤 2 类型" }).selectOption("tool");
    await expectInsideInspector(inspector.getByRole("combobox", { name: "步骤组步骤 2 业务工具" }));
    const deleteStep = inspector.getByRole("button", { name: "删除步骤组步骤 2" });
    await expectInsideInspector(deleteStep);
    await deleteStep.click();
    await expect(stepName).toHaveCount(0);
    await page.getByRole("button", { name: "关闭节点详情" }).last().click();
    await page.getByRole("button", { name: "放弃修改" }).click();
    await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
    await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();

    await addType.selectOption("condition");
    await add.click();
    await expect(inspector).toBeVisible();
    await inspector.getByRole("button", { name: "添加并列条件" }).first().click();
    await inspector.getByRole("button", { name: "添加条件" }).click();
    const ruleValue = inspector.getByRole("textbox", { name: "情况 1 条件 2 比较值" });
    await expectInsideInspector(ruleValue);
    await ruleValue.fill("已确认");
    await expectInsideInspector(inspector.getByRole("combobox", { name: "情况 1 条件 2 判断方式" }));
    const deleteRule = inspector.getByRole("button", { name: "删除情况 1 条件 2" });
    await expectInsideInspector(deleteRule);
    await deleteRule.click();
    await expect(ruleValue).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "关闭节点详情" }).last().click();
    await page.getByRole("button", { name: "放弃修改" }).click();
    await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
    await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  }
});

test("真实业务步骤在手机端展示草稿依据或明确缺失状态", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents/79308fdc-0f53-4df3-aa99-61a1523609ff#workflow", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  const step = page.locator("#workflow ol > li > button").filter({
    hasText: /智能处理|员工确认|操作业务系统|读取资料|分情况处理|按规则检查|逐项处理|同时处理|等待后继续|参考经验|一组步骤|呼叫其他助手|交给其他助手/,
  }).first();
  test.skip(!(await step.isVisible()), "当前助手没有可查看的业务步骤");

  await expect(page.locator("#workflow ol")).toContainText("业务目标：");
  if (process.env.CAPTURE_BUSINESS_EVIDENCE_AUDIT === "1") await page.locator("#workflow ol").screenshot({ path: "qa/business-step-guide-mobile.png" });
  await step.click();
  const card = page.getByRole("region", { name: "业务依据与完成标准" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("修改步骤后，这些记录可能不再适用");
  if (await card.getByText("这一步还没有业务规格").isVisible()) {
    await expect(card).toContainText("设计检查会指出缺少的需求证据");
  } else {
    await expect(card.locator("dt")).toHaveCount(7);
    await expect(card).toContainText("完成标准");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_BUSINESS_EVIDENCE_AUDIT === "1") await card.screenshot({ path: "qa/business-evidence-mobile.png" });
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});

test("现有助手的流程在手机端按真实连接导览，草稿操作可安全放弃", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  await expect(page.getByRole("heading", { level: 1, name: "助手" })).toBeVisible();
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");

  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  await expect(page.getByText(/按流程连接查看；条件分支会择一执行/)).toBeVisible();
  await expect(page.getByText("执行步骤", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  const stepCount = await page.locator("main ol li").count();
  expect(stepCount).toBeGreaterThan(0);
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/audit-2026-09-27-workflow/01-mobile-step-guide.png", fullPage: true });

  const addType = page.getByRole("combobox", { name: "新增步骤类型" });
  if (await addType.isEnabled()) {
    await addType.selectOption("ai");
    const add = page.getByRole("button", { name: "添加", exact: true });
    if (await add.isEnabled()) {
      await add.click();
      await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "关闭节点详情" }).last().click();
      await page.getByRole("button", { name: "撤销上一步修改" }).click();
      await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
      await expect(page.getByRole("button", { name: "重做上一步修改" })).toBeEnabled();
      await page.getByRole("button", { name: "重做上一步修改" }).click();
      await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "放弃修改" }).click();
      await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
      await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    }
  }
});

test("流程输入中快捷保存沿用校验，不写入无效草稿", async ({ page }) => {
  await page.goto("/agents");
  const agentHref = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).find((href) => Boolean(href && /^\/agents\/[0-9a-f-]{36}$/.test(href))),
  );
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  await page.getByText(/运行输入字段/).click();
  const addInput = page.getByRole("button", { name: "添加输入字段" });
  test.skip(!(await addInput.isEnabled()), "当前流程已达到输入字段上限");
  await addInput.click();
  const fieldName = page.getByRole("textbox", { name: /字段 \d+ 名称/ }).last();
  await fieldName.fill("");
  await fieldName.press("Control+s");
  await expect(page.getByText("运行输入字段名必须以字母或下划线开头，且不能重复")).toBeVisible();
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
});

test("流程输入字段可直接点击删除，桌面和手机端均可回到原草稿", async ({ page }) => {
  await page.goto("/agents");
  const agentHref = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).find((href) => Boolean(href && /^\/agents\/[0-9a-f-]{36}$/.test(href))),
  );
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${agentHref}#workflow`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
    const inputDetails = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "运行输入字段" }) });
    if (!(await inputDetails.evaluate((element: HTMLDetailsElement) => element.open))) await inputDetails.locator("summary").click();
    const inputFields = page.getByRole("textbox", { name: /字段 \d+ 名称/ });
    const previousInputCount = await inputFields.count();
    const addInput = page.getByRole("button", { name: "添加输入字段" });
    test.skip(!(await addInput.isEnabled()), "当前流程已达到输入字段上限");
    await addInput.click();
    const fieldName = inputFields.last();
    await expect(fieldName).toBeVisible();
    const remove = fieldName.locator("../..").getByRole("button", { name: "删除" });
    await remove.scrollIntoViewIfNeeded();
    const hit = await remove.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const details = button.closest("details")?.getBoundingClientRect();
      return { button: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }, target: target?.tagName, targetClass: target?.getAttribute("class"), details: { top: details?.top, height: details?.height }, scrollY: window.scrollY };
    });
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `qa/workflow-input-delete-${width}.png` });
    expect(hit.target, JSON.stringify(hit)).toBe("BUTTON");
    await remove.click({ timeout: 10_000 });
    await expect(inputFields).toHaveCount(previousInputCount);
    const outputDetails = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: "最终交付字段" }) });
    if (!(await outputDetails.evaluate((element: HTMLDetailsElement) => element.open))) await outputDetails.locator("summary").click();
    const outputFields = page.getByRole("textbox", { name: /交付字段 \d+ 位置/ });
    const previousOutputCount = await outputFields.count();
    const addOutput = page.getByRole("button", { name: "添加交付字段" });
    test.skip(!(await addOutput.isEnabled()), "当前流程没有可新增的交付字段");
    await addOutput.click();
    await expect(outputFields).toHaveCount(previousOutputCount + 1);
    await outputFields.last().locator("../..").getByRole("button", { name: "删除" }).click({ timeout: 10_000 });
    await expect(outputFields).toHaveCount(previousOutputCount);
    await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("新增业务工具不预绑定演示能力，整理画布仍保留未保存提示", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!);
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("tool");
  const add = page.getByRole("button", { name: "添加", exact: true });
  test.skip(!(await add.isEnabled()), "当前流程已达到步骤上限");
  await add.click();
  await expect(page.getByRole("combobox", { name: "业务工具", exact: true })).toHaveValue("");
  await expect(page.getByText(/尚未绑定可用的业务工具/)).toBeVisible();
  const bindingSummary = page.getByRole("region", { name: "业务工具绑定概况" });
  await expect(bindingSummary).toContainText(/画布上 \d+ 个工具步骤/);
  await expect(bindingSummary).toContainText("演示工具不连接业务系统");
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/workflow-unbound-tool-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  if (process.env.CAPTURE_UI_AUDIT === "1") await bindingSummary.screenshot({ path: "qa/workflow-tool-binding-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(bindingSummary).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await bindingSummary.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -140));
    await bindingSummary.screenshot({ path: "qa/workflow-tool-binding-desktop.png" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText(/当前草稿有 \d+ 项基础问题/).click();
  await expect(page.getByRole("button", { name: /需要选择业务工具/ }).last()).toBeVisible();
  await expect(page.getByText(/这不是发布或运行的通过结论/)).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.getByText(/当前草稿有 \d+ 项基础问题/).locator("..").screenshot({ path: "qa/workflow-basic-issues-mobile.png" });
  await page.getByRole("button", { name: "自动整理画布" }).click();
  await expect(page.getByText("已整理画布位置，保存草稿后生效")).toBeVisible();
  await expect(page.getByRole("button", { name: "流程画布" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
  await expect.poll(() => page.locator(".react-flow__viewport").evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a)).toBeGreaterThan(0.6);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.screenshot({ path: "qa/workflow-arranged-mobile.png", fullPage: true });
    await page.locator(".react-flow").screenshot({ path: "qa/workflow-arranged-canvas-mobile.png" });
  }
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
});

test("手机端可在指定步骤后插入并接回原路径，撤销后不会误保存", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  const steps = page.locator("#workflow ol > li");
  const before = await steps.count();
  const position = page.getByRole("combobox", { name: "新增步骤位置" });
  const firstPosition = await position.locator('option:not([value=""])').first().getAttribute("value");
  test.skip(!firstPosition, "当前流程没有可插入的位置");
  await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("ai");
  await position.selectOption(firstPosition!);
  const insert = page.getByRole("button", { name: "插入", exact: true });
  test.skip(!(await insert.isEnabled()), "当前流程已达到步骤上限");
  await insert.click();
  await expect(page.getByText("已插入到所选路径，保存草稿后生效")).toBeVisible();
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await expect(steps).toHaveCount(before + 1);
  const inserted = steps.filter({ hasText: "新增智能处理" }).last();
  await expect(inserted).not.toContainText("未连接到起点");
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await position.locator("..").locator("..").locator("..").screenshot({ path: "qa/workflow-insert-toolbar-mobile.png" });
    await inserted.screenshot({ path: "qa/workflow-insert-step-mobile.png" });
  }
  await page.getByRole("button", { name: "撤销上一步修改" }).click();
  await expect(steps).toHaveCount(before);
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "重做上一步修改" }).click();
  await expect(steps).toHaveCount(before + 1);
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("手机端仅对单一路径的相邻步骤开放换序并可撤销", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  const type = page.getByRole("combobox", { name: "新增步骤类型" });
  const position = page.getByRole("combobox", { name: "新增步骤位置" });
  const firstPosition = await position.locator('option:not([value=""])').first().getAttribute("value");
  test.skip(!firstPosition, "当前流程没有可插入的位置");
  await position.selectOption(firstPosition!);
  await type.selectOption("ai");
  const insert = page.getByRole("button", { name: "插入", exact: true });
  test.skip(!(await insert.isEnabled()), "当前流程已达到步骤上限");
  await insert.click();
  await page.getByRole("textbox", { name: "节点名称" }).fill("本地步骤甲");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();

  await expect(position).not.toHaveValue("");
  await type.selectOption("ai");
  await insert.click();
  await page.getByRole("textbox", { name: "节点名称" }).fill("本地步骤乙");
  const moveUp = page.getByRole("button", { name: "上移步骤" });
  await expect(moveUp).toBeEnabled();
  await moveUp.click();
  await expect(page.getByText("已调整步骤顺序，保存草稿后生效；可撤销")).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.locator('aside[aria-label="节点详情"]').screenshot({ path: "qa/workflow-step-order-mobile.png" });
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  const stepTitles = async () => page.locator("#workflow ol > li > button").allTextContents();
  const moved = await stepTitles();
  const movedA = moved.findIndex((title) => title.includes("本地步骤甲"));
  const movedB = moved.findIndex((title) => title.includes("本地步骤乙"));
  expect(movedA).toBeGreaterThanOrEqual(0);
  expect(movedB).toBeGreaterThanOrEqual(0);
  expect(movedB).toBeLessThan(movedA);
  await page.getByRole("button", { name: "撤销上一步修改" }).click();
  const restored = await stepTitles();
  expect(restored.findIndex((title) => title.includes("本地步骤甲"))).toBeLessThan(restored.findIndex((title) => title.includes("本地步骤乙")));
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("手机端删除单一路径步骤后会接续后续步骤，撤销可恢复原路径", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  const type = page.getByRole("combobox", { name: "新增步骤类型" });
  const position = page.getByRole("combobox", { name: "新增步骤位置" });
  const firstPosition = await position.locator('option:not([value=""])').first().getAttribute("value");
  test.skip(!firstPosition, "当前流程没有可插入的位置");
  await position.selectOption(firstPosition!);
  await type.selectOption("ai");
  const insert = page.getByRole("button", { name: "插入", exact: true });
  test.skip(!(await insert.isEnabled()), "当前流程已达到步骤上限");
  await insert.click();
  await page.getByRole("textbox", { name: "节点名称" }).fill("本地接续甲");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await type.selectOption("ai");
  await insert.click();
  await page.getByRole("textbox", { name: "节点名称" }).fill("本地接续乙");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.locator("#workflow ol > li > button").filter({ hasText: "本地接续甲" }).click();
  await page.getByRole("button", { name: "删除节点" }).click();
  await expect(page.getByRole("dialog", { name: "删除这个节点？" })).toContainText("前一步会直接接到“本地接续乙”");
  await page.getByRole("dialog", { name: "删除这个节点？" }).getByRole("button", { name: "删除节点" }).click();
  await expect(page.getByText(/前后路径已接续到“本地接续乙”/)).toBeVisible();
  await expect(page.locator("#workflow ol > li > button").filter({ hasText: "本地接续甲" })).toHaveCount(0);
  await expect(page.locator("#workflow ol > li > button").filter({ hasText: "本地接续乙" }).locator("..")).not.toContainText("未连接到起点");
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: "qa/workflow-delete-continuation-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "撤销上一步修改" }).click();
  await expect(page.locator("#workflow ol > li > button").filter({ hasText: "本地接续甲" })).toHaveCount(1);
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("手机端可在节点详情调整后续路径并撤销，不会误保存", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  const position = page.getByRole("combobox", { name: "新增步骤位置" });
  const firstPosition = await position.locator('option:not([value=""])').first().getAttribute("value");
  test.skip(!firstPosition, "当前流程没有可插入的位置");
  await position.selectOption(firstPosition!);
  await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("ai");
  const insert = page.getByRole("button", { name: "插入", exact: true });
  test.skip(!(await insert.isEnabled()), "当前流程已达到步骤上限");
  await insert.click();
  await page.getByRole("textbox", { name: "节点名称" }).fill("本地路径设置");
  const nextRoute = page.getByRole("combobox", { name: "完成后的目标步骤" });
  const previousTarget = await nextRoute.inputValue();
  test.skip(!previousTarget, "当前插入位置没有后续步骤");
  await nextRoute.selectOption("");
  await expect(page.getByText("已断开这条路径，保存草稿后生效；可撤销")).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await page.locator('[aria-label="步骤流转设置"]').screenshot({ path: "qa/workflow-route-editor-mobile.png" });
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "撤销上一步修改" }).click();
  await page.locator("#workflow ol > li > button").filter({ hasText: "本地路径设置" }).click();
  await expect(page.getByRole("combobox", { name: "完成后的目标步骤" })).toHaveValue(previousTarget);
  await page.locator('[aria-label="步骤流转设置"]').getByRole("button", { name: /^断开来自/ }).first().click();
  const disconnectDialog = page.getByRole("dialog", { name: "断开这条上游路径？" });
  await expect(disconnectDialog).toContainText("将不再进入“本地路径设置”");
  if (process.env.CAPTURE_UI_AUDIT === "1") await disconnectDialog.screenshot({ path: "qa/workflow-incoming-disconnect-mobile.png" });
  await disconnectDialog.getByRole("button", { name: "断开路径" }).click();
  await expect(page.getByText("已断开这条路径，保存草稿后生效；可撤销")).toBeVisible();
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "撤销上一步修改" }).click();
  await page.locator("#workflow ol > li > button").filter({ hasText: "本地路径设置" }).click();
  await expect(page.locator('[aria-label="步骤流转设置"]').getByRole("button", { name: /^断开来自/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("手机端更改已有步骤的处理类型前预览影响，确认后保留主路径并可撤销", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  const position = page.getByRole("combobox", { name: "新增步骤位置" });
  const firstPosition = await position.locator('option:not([value=""])').first().getAttribute("value");
  test.skip(!firstPosition, "当前流程没有可插入的位置");
  await position.selectOption(firstPosition!);
  await page.getByRole("combobox", { name: "新增步骤类型" }).selectOption("ai");
  const insert = page.getByRole("button", { name: "插入", exact: true });
  test.skip(!(await insert.isEnabled()), "当前流程已达到步骤上限");
  await insert.click();
  await page.getByRole("textbox", { name: "节点名称" }).fill("本地类型设置");
  const originalTarget = await page.getByRole("combobox", { name: "完成后的目标步骤" }).inputValue();
  await page.getByRole("combobox", { name: "处理类型" }).selectOption("knowledge");
  const confirmation = page.getByRole("dialog", { name: "更改这一步的处理类型？" });
  await expect(confirmation).toContainText("保留步骤名称、位置及主要后续路径");
  if (process.env.CAPTURE_UI_AUDIT === "1") await confirmation.screenshot({ path: "qa/workflow-change-type-mobile.png" });
  await confirmation.getByRole("button", { name: "确认更改" }).click();
  await expect(page.getByRole("combobox", { name: "处理类型" })).toHaveValue("knowledge");
  await expect(page.getByRole("textbox", { name: "检索内容" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "完成后的目标步骤" })).toHaveValue(originalTarget);
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "撤销上一步修改" }).click();
  await page.locator("#workflow ol > li > button").filter({ hasText: "本地类型设置" }).click();
  await expect(page.getByRole("combobox", { name: "处理类型" })).toHaveValue("ai");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByRole("dialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("手机和桌面可全屏查看画布与节点详情，退出不改变草稿", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents", { waitUntil: "domcontentloaded" });
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  await page.getByRole("button", { name: "全屏编辑流程" }).click();
  const fullscreen = page.getByLabel("全屏流程画布");
  await expect(fullscreen).toBeVisible();
  await expect(page.getByRole("button", { name: "流程画布" })).toHaveAttribute("aria-pressed", "true");
  await expect(fullscreen.locator(".react-flow__node").first()).toBeVisible();
  const mobileBounds = await fullscreen.boundingBox();
  expect(mobileBounds?.width).toBe(390);
  expect(mobileBounds?.height).toBe(844);
  if (process.env.CAPTURE_UI_AUDIT === "1") await fullscreen.screenshot({ path: "qa/workflow-fullscreen-mobile.png" });
  await page.getByRole("button", { name: "退出全屏编辑" }).click();
  await expect(fullscreen).not.toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "全屏编辑流程" }).click();
  await expect(fullscreen).toBeVisible();
  await fullscreen.locator(".react-flow__node").first().click();
  await expect(fullscreen.locator('aside[aria-label="节点详情"]')).toBeVisible();
  if (process.env.CAPTURE_UI_AUDIT === "1") await fullscreen.screenshot({ path: "qa/workflow-fullscreen-desktop.png" });
  await page.keyboard.press("Escape");
  await expect(fullscreen.locator('aside[aria-label="节点详情"]')).not.toBeVisible();
  await page.keyboard.press("Escape");
  await expect(fullscreen).not.toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
});

test("云端流程变化时保留本标签页旧草稿并提供下载", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");
  const agentId = agentHref!.split("/").at(-1)!;

  await page.goto(agentHref!, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  await page.getByText(/运行输入字段/).click();
  await page.getByRole("button", { name: "添加输入字段" }).click();
  await expect(page.getByText("有未保存修改", { exact: true })).toBeVisible();
  await page.waitForFunction((id) => Boolean(sessionStorage.getItem(`agent-studio:workflow-draft:${id}`)), agentId);
  await page.evaluate((id) => {
    const key = `agent-studio:workflow-draft:${id}`;
    const record = JSON.parse(sessionStorage.getItem(key)!) as Record<string, unknown>;
    record.savedFingerprint = "另一个云端版本";
    sessionStorage.setItem(key, JSON.stringify(record));
  }, agentId);
  expect(await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`agent-studio:workflow-draft:${id}`)!)?.savedFingerprint, agentId)).toBe("另一个云端版本");
  page.on("dialog", (dialog) => { void dialog.accept(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  expect(await page.evaluate((id) => sessionStorage.getItem(`agent-studio:workflow-draft:${id}`), agentId)).not.toBeNull();
  expect(await page.evaluate((id) => JSON.parse(sessionStorage.getItem(`agent-studio:workflow-draft:${id}`)!)?.savedFingerprint, agentId)).toBe("另一个云端版本");

  await expect(page.getByRole("heading", { name: "本地流程副本需要核对" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载本地流程副本" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("流程-本地副本.json");
  expect(await page.evaluate((id) => Boolean(sessionStorage.getItem(`agent-studio:workflow-draft:${id}`)), agentId)).toBe(true);
  await page.getByRole("button", { name: "清除本地副本并继续" }).click();
  await expect(page.getByRole("dialog", { name: "清除本地流程副本？" })).toBeVisible();
  await page.getByRole("button", { name: "清除副本并继续" }).click();
  await expect(page.getByRole("heading", { name: "流程设计" })).toBeVisible();
  expect(await page.evaluate((id) => sessionStorage.getItem(`agent-studio:workflow-draft:${id}`), agentId)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
