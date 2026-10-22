import { expect, test } from "@playwright/test";
import { VersionExportFile } from "../../src/contracts/version";

test("桌面网页工具用真实正式字段试填、定位、切换布局和确认清空，不发起运行", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  await page.goto("/releases");
  await page.locator("main").getByRole("link", { name: "网页工具", exact: true }).click();
  await expect(page).toHaveURL(/\/web-tools$/);
  const source = page.getByRole("combobox", { name: "用于核对的助手版本" });
  const options = source.locator('option:not([disabled])').filter({ hasText: "客服测试助手-" });
  await expect(options.first(), "需要已有创建闭环产生的真实正式版本，而不是演示字段").toBeAttached();
  const latest = await options.evaluateAll((elements) => elements
    .map((element) => ({ value: element.getAttribute("value"), created: Number(element.textContent?.match(/客服测试助手-(\d+)/)?.[1]) }))
    .filter((option) => option.value && Number.isFinite(option.created))
    .sort((left, right) => right.created - left.created)[0]);
  expect(latest, "使用最近一次真实创建闭环发布的版本，不选取早期缺少交付字段的历史测试助手").toBeTruthy();
  const version = latest.value;
  expect(version).toMatch(/^[0-9a-f-]{36}$/i);
  await source.selectOption(version!);
  await page.getByRole("button", { name: "核对版本字段" }).click();
  await expect(page).toHaveURL(new RegExp(`/web-tools\\?version=${version}$`));
  const preview = page.getByRole("region", { name: "网页填写预览" });
  const controls = preview.locator("[data-preview-field-index]");
  await expect(preview).toBeVisible();
  await expect(controls.first()).toBeAttached();
  const agentHref = await page.getByRole("link", { name: "查看助手版本", exact: true }).getAttribute("href");
  const agentId = agentHref?.match(/^\/agents\/([0-9a-f-]{36})#versions$/i)?.[1];
  expect(agentId).toBeTruthy();
  const exported = await page.request.get(`/api/agents/${agentId}/versions/${version}/export`);
  expect(exported.ok(), "通过现有只读导出接口核对真实已保存的正式契约").toBe(true);
  const saved = VersionExportFile.parse(await exported.json());
  expect(saved.version.status).toBe("production");
  expect(saved.manifest.inputContract.fields.length).toBeGreaterThan(0);
  expect(saved.manifest.outputContract?.fields.length).toBeGreaterThan(0);
  await expect(controls).toHaveCount(saved.manifest.inputContract.fields.length);
  for (const [index, field] of saved.manifest.inputContract.fields.entries()) {
    await expect(controls.nth(index)).toHaveAccessibleName(`${field.label?.trim() || `业务信息 ${index + 1}`}（${field.required ? "必填" : "选填"}）`);
    await expect(controls.nth(index)).toHaveAttribute("aria-required", String(field.required));
  }
  const firstRequired = preview.locator('[data-preview-field-index][aria-required="true"]').first();
  await expect(firstRequired).toBeAttached();
  await preview.getByRole("button", { name: "定位下一项未填必填", exact: true }).click();
  await expect(firstRequired).toBeFocused();
  await preview.getByRole("button", { name: "检查填写格式" }).click();
  await expect(preview.getByRole("status")).toContainText("填写需要修改");
  await expect(firstRequired).toBeFocused();
  await expect(firstRequired).toHaveAttribute("aria-invalid", "true");
  const focusLink = preview.getByRole("status").getByRole("button").first();
  await focusLink.click();
  await expect(firstRequired).toBeFocused();
  for (const control of await controls.all()) {
    const description = await control.getAttribute("aria-describedby");
    const type = await page.locator(`[id="${description!.split(" ")[0]}"]`).innerText();
    if (type.startsWith("是或否")) await control.selectOption("false");
    else await control.fill(type.startsWith("数字") ? "0" : type.startsWith("对象") ? "{}" : type.startsWith("列表") ? "[]" : "桌面本地试填\n核对真实业务字段");
  }
  await preview.getByRole("button", { name: "检查填写格式" }).click();
  await expect(preview.getByRole("status")).toContainText("没有提交或运行任务");
  await expect(preview.getByRole("button", { name: "定位下一项未填必填", exact: true })).toHaveCount(0);
  const multilineIndex = saved.manifest.inputContract.fields.findIndex((field) => ["string", "object", "array"].includes(field.type));
  expect(multilineIndex, "真实契约应提供至少一个多行输入用于桌面长文本验收").toBeGreaterThanOrEqual(0);
  const multiline = controls.nth(multilineIndex);
  const preserved = await multiline.inputValue();
  await preview.getByRole("button", { name: `展开第 ${multilineIndex + 1} 项填写区`, exact: true }).click();
  await expect(multiline).toHaveAttribute("rows", "8");
  await expect(multiline).toHaveValue(preserved);
  await preview.getByRole("button", { name: `收起第 ${multilineIndex + 1} 项填写区`, exact: true }).click();
  await expect(multiline).toHaveAttribute("rows", "3");
  const firstValue = await controls.first().inputValue();
  await preview.getByRole("button", { name: "单列填写" }).click();
  await expect(preview.getByRole("button", { name: "单列填写" })).toHaveAttribute("aria-pressed", "true");
  await expect(controls.first()).toHaveValue(firstValue);
  const output = page.getByRole("region", { name: "交付布局预览" });
  await expect(output).toBeVisible();
  const outputItems = output.getByRole("list", { name: "本版本交付布局" }).getByRole("listitem");
  await expect(outputItems).toHaveCount(saved.manifest.outputContract!.fields.length);
  for (const [index, field] of saved.manifest.outputContract!.fields.entries()) {
    await expect(outputItems.nth(index)).toContainText(field.label?.trim() || `交付内容 ${index + 1}`);
  }
  const before = await outputItems.allTextContents();
  await expect(outputItems.first()).toContainText("仅占位，尚无网页调用结果");
  await output.getByRole("button", { name: "交付清单" }).click();
  await expect(output.getByRole("button", { name: "交付清单" })).toHaveAttribute("aria-pressed", "true");
  expect(await outputItems.allTextContents()).toEqual(before);
  await expect(controls.first()).toHaveValue(firstValue);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await preview.evaluate((element) => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 80));
    await preview.screenshot({ path: "qa/web-tool-input-preview-desktop.png" });
    await output.evaluate((element) => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 80));
    await output.screenshot({ path: "qa/web-tool-output-preview-desktop.png" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: "qa/web-tool-page-desktop.png", fullPage: true });
  }
  await preview.getByRole("button", { name: "清空试填" }).click();
  const confirmation = page.getByRole("dialog", { name: "清空当前试填内容？" });
  await expect(confirmation).toContainText("不会修改助手版本");
  await confirmation.getByRole("button", { name: "返回", exact: true }).click();
  await expect(controls.first()).toHaveValue(firstValue);
  await preview.getByRole("button", { name: "清空试填" }).click();
  await confirmation.getByRole("button", { name: "确认清空试填" }).click();
  for (const control of await controls.all()) await expect(control).toHaveValue("");
  await expect(preview.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "当前不能发布网页工具" })).toBeVisible();
  expect(writes).toEqual([]);
});

test("桌面网页工具失效版本链接不替换正式来源或展示试填和交付", async ({ page }) => {
  const selections = [{ version: "not-a-version", invalid: true }, { version: crypto.randomUUID(), invalid: false }];
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const selection of selections) {
      await page.goto(`/web-tools?version=${selection.version}`);
      await expect(page.getByRole("heading", { name: selection.invalid ? "等待选择正式版本" : "找不到这个正式版本" })).toBeVisible();
      if (selection.invalid) await expect(page.getByRole("alert").filter({ hasText: "网址中的版本或运行选择无法核对" })).toBeVisible();
      await expect(page.getByRole("region", { name: "网页填写预览" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "交付布局预览" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "当前不能发布网页工具" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
});
