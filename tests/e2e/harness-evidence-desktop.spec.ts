import { expect, test } from "@playwright/test";

test("桌面证据概览定位真实分区，保留任务与筛选且不提交动作", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/harness");
  const first = page.getByRole("navigation", { name: "选择诊断任务" }).getByRole("link").first();
  await expect(first).toBeVisible();
  const runId = new URL((await first.getAttribute("href"))!, page.url()).searchParams.get("run")!;
  expect(runId).toMatch(/^[0-9a-f-]{36}$/i);
  const params = new URLSearchParams({ run: runId, traceQuery: "诊断核对", contextPage: "0" });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/harness?" + params);
    const overview = page.getByRole("region", { name: "本次证据读取" });
    await expect(overview).toBeVisible();
    await expect(overview.getByText("筛选无效，本次未读取")).toBeVisible();
    for (const [label, anchor] of [
      ["定位步骤证据", "diagnostic-steps"], ["定位轨迹证据", "diagnostic-trace"],
      ["定位快照证据", "saved-context"], ["核对本次任务的下一步", "diagnostic-next-step"],
    ]) {
      const link = overview.getByRole("link", { name: new RegExp(label) });
      await expect(link).toHaveAttribute("href", "#" + anchor);
      await link.click();
      await expect(page.locator("#" + anchor)).toBeInViewport();
      const current = new URL(page.url());
      expect(current.hash).toBe("#" + anchor);
      expect(current.searchParams.toString()).toBe(params.toString());
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (process.env.CAPTURE_UI_AUDIT === "1") await page.screenshot({ path: `qa/harness-evidence-${width}.png`, fullPage: true });
  }
  expect(writes).toEqual([]);
});
