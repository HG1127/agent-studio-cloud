import { expect, test } from "@playwright/test";

const AGENT_ID = "79308fdc-0f53-4df3-aa99-61a1523609ff";
const WAITING_RUN_ID = "488fc73c-4ab7-4c10-a182-c9262b81175d";
const COMPLETED_RUN_ID = "61dd64f8-43e7-43ef-bc77-3345c57cfe5b";
const FAILED_RUN_ID = "9bb972de-2458-4afb-8a77-4b2fd538776d";

test("真实运行入口、人工确认与结果证据形成连续路径", async ({ page }) => {
  const baseline = process.env.CAPTURE_RUN_LIFECYCLE_BASELINE === "1";

  await page.goto(`/agents/${AGENT_ID}#run`);
  const launcher = page.locator("#run");
  await expect(launcher.getByRole("heading", { name: "试运行" })).toBeVisible();
  if (baseline) {
    await launcher.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/00-baseline-run-launcher-section.png" });
  } else {
    await expect(launcher.getByText("正式版本 V1")).toBeVisible();
    await expect(launcher.getByRole("complementary", { name: "本次运行说明" })).toContainText("固定使用当前正式版本");
    await expect(launcher.getByText("完成后可查看与复制")).toBeVisible();
    await expect(launcher.getByRole("button", { name: "开始试运行" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(launcher.getByText("完成后可查看与复制")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 720 });
    if (process.env.CAPTURE_UI_AUDIT) {
      await launcher.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/04-final-run-launcher-section.png" });
    }
  }

  await page.goto(`/runs/${WAITING_RUN_ID}`);
  const approval = page.locator("section").filter({ hasText: "该步骤正在等待确认" }).first();
  await expect(approval).toBeVisible();
  if (baseline) {
    await approval.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/01-baseline-waiting-approval-section.png" });
  } else {
    await expect(page.getByRole("heading", { name: "确认后才能继续" })).toBeVisible();
    await expect(approval.getByText("从当前暂停位置继续执行后续步骤。")).toBeVisible();
    await expect(approval.getByText("本次运行安全结束，不执行后续交付。")).toBeVisible();
    await approval.getByRole("button", { name: "拒绝并结束" }).click();
    await expect(page.getByRole("dialog", { name: "拒绝并结束这次运行？" })).toBeVisible();
    await page.getByRole("button", { name: "关闭确认弹窗" }).click();
    if (process.env.CAPTURE_UI_AUDIT) {
      await approval.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/05-final-waiting-approval-section.png" });
    }
  }

  await page.goto(`/runs/${COMPLETED_RUN_ID}#result`);
  const result = page.locator("#result");
  await expect(result.getByRole("heading", { name: "最终结果" })).toBeVisible();
  if (baseline) {
    await result.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/02-baseline-completed-result-section.png" });
  } else {
    await expect(page.getByRole("heading", { name: "结果与执行证据已保存" })).toBeVisible();
    const resultBox = await result.boundingBox();
    const inputBox = await page.locator("#input").boundingBox();
    expect(resultBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(inputBox?.y ?? 0);
    if (process.env.CAPTURE_UI_AUDIT) {
      await page.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/06-final-completed-result-first.png", fullPage: false });
    }
  }

  await page.goto(`/runs/${FAILED_RUN_ID}`);
  const failureAlert = page.locator("main > [role='alert']").first();
  await expect(failureAlert).toBeVisible();
  if (baseline) {
    await failureAlert.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/03-baseline-failed-alert.png" });
  } else {
    await expect(page.getByRole("heading", { name: "先核对失败原因，再决定是否重试" })).toBeVisible();
    await expect(failureAlert).toContainText("失败原因");
    await page.getByRole("button", { name: "按原输入再次运行" }).click();
    await expect(page.getByRole("dialog", { name: "按原输入创建一次新运行？" })).toBeVisible();
    await page.getByRole("button", { name: "关闭确认弹窗" }).click();
    if (process.env.CAPTURE_UI_AUDIT) {
      await page.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/07-final-failed-recovery.png", fullPage: false });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/runs/${WAITING_RUN_ID}`);
    await expect(page.getByRole("heading", { name: "确认后才能继续" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.CAPTURE_UI_AUDIT) {
      await page.screenshot({ path: "qa/audit-2026-09-26-run-lifecycle/08-final-waiting-approval-mobile.png", fullPage: true });
    }
  }
});
