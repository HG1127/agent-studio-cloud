import { expect, test } from "@playwright/test";

test("手机端编辑助手基本信息，取消时不会写入工作区", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agents");
  const hrefs = await page.locator('main a[href^="/agents/"]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  const agentHref = hrefs.find((href) => /^\/agents\/[0-9a-f-]{36}$/.test(href));
  test.skip(!agentHref, "当前工作区没有可查看的助手");

  await page.goto(agentHref!);
  await page.getByRole("button", { name: "编辑名称和说明" }).click();
  const form = page.getByRole("form", { name: "编辑助手基本信息" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("button", { name: "保存信息" })).toBeDisabled();
  const description = form.getByLabel("编辑助手说明");
  const original = await description.inputValue();
  const changed = original === "浏览器未保存核对" ? "浏览器未保存核对二" : "浏览器未保存核对";
  await description.fill(changed);
  await expect(form.getByRole("button", { name: "保存信息" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.CAPTURE_METADATA_AUDIT === "1") await form.screenshot({ path: "qa/agent-metadata-mobile-editor.png" });

  await form.getByRole("button", { name: "取消" }).click();
  const confirmation = page.getByRole("dialog", { name: "放弃基本信息修改？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "关闭确认弹窗" }).click();
  await expect(description).toHaveValue(changed);
  await form.getByRole("button", { name: "取消" }).click();
  await confirmation.getByRole("button", { name: "放弃修改" }).click();
  await expect(form).not.toBeVisible();
  await page.getByRole("button", { name: "编辑名称和说明" }).click();
  await expect(page.getByLabel("编辑助手说明")).toHaveValue(original);
});
