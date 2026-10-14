import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { MemoryAgentOption } from "../../src/contracts/memory";
import { RunReportFile } from "../../src/contracts/run";

function isolatedDesktop(info: TestInfo) {
  const base = info.project.use.baseURL;
  const host = typeof base === "string" ? new URL(base).hostname : "";
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error("须由专用CI核对隔离数据库、本机服务与模拟模型；不能使用生产配置或跳过");
}

async function realSource(page: Page, href: string | null, agentId: string) {
  if (!href || !/^\/runs\/[^/?#]+$/.test(href)) throw new Error("夹具必须提供真实来源运行链接，不能猜测任务或注入成功报告");
  const id = MemoryAgentOption.shape.id.parse(href.slice("/runs/".length));
  const response = await page.request.get(`/api/runs/${id}/export`);
  expect(response.ok()).toBe(true);
  const report = RunReportFile.parse(await response.json());
  expect(report.run.id.toLowerCase()).toBe(id.toLowerCase());
  expect(report.run.agentId.toLowerCase()).toBe(agentId);
}

test("桌面成长中心拒绝无效和重复助手范围，不把它们当成全部助手", async ({ page }, info) => {
  isolatedDesktop(info); await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = []; const errors: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("pageerror", (error) => errors.push(error.message));
  const valid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const suffix of ["agent=not-an-agent", `agent=${valid}&agent=${valid}`, "q=%E5%AE%A2%E6%88%B7&q=%E5%85%B6%E4%BB%96", "page=1&page=2"]) {
    await page.goto(`/memory?${suffix}`);
    const notice = page.getByRole("region", { name: "成长中心筛选条件暂不可用", exact: true });
    await expect(notice).toBeVisible(); await expect(notice).toContainText("不会自动扩大为全部助手");
    await expect(notice.getByRole("link", { name: "清除无效筛选", exact: true })).toHaveAttribute("href", "/memory");
    await expect(page.getByRole("region", { name: "长期经验", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "待改进结果", exact: true })).toHaveCount(0);
  }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test("桌面成长中心真实助手范围、来源报告与只读刷新保持一致", async ({ page }, info) => {
  isolatedDesktop(info); await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = MemoryAgentOption.shape.id.safeParse(process.env.MEMORY_RESILIENCE_E2E_AGENT_ID);
  if (!fixture.success) throw new Error("CI须预置拥有真实长期经验和待改进结果的隔离助手，不能使用空页或伪造成功夹具");
  const agentId = fixture.data.toLowerCase(); const writes: string[] = []; const errors: string[] = [];
  page.on("request", (request) => { if (!["GET", "HEAD"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/memory?agent=${agentId}`);
  const memory = page.getByRole("region", { name: "长期经验", exact: true });
  const feedback = page.getByRole("region", { name: "待改进结果", exact: true });
  await expect(memory).toBeVisible(); await expect(feedback).toBeVisible();
  if (await memory.getByRole("listitem").count() < 1 || await feedback.getByRole("listitem").count() < 1) throw new Error("CI须准备实际保存的经验和待改进反馈，缺少时不跳过、不将空页当通过");
  const selector = page.getByRole("combobox", { name: "助手", exact: true });
  await expect(selector).toHaveValue(agentId); await expect(selector).toBeEnabled();
  await realSource(page, await memory.getByRole("link", { name: "查看来源运行", exact: true }).first().getAttribute("href"), agentId);
  await realSource(page, await feedback.getByRole("link", { name: "查看来源运行", exact: true }).first().getAttribute("href"), agentId);
  const keyword = page.getByRole("textbox", { name: "内容关键词", exact: true });
  const name = await selector.locator("option:checked").textContent();
  if (!name?.trim() || name.includes("名称暂不可核对")) throw new Error("实际助手选项必须可读，不能用未知名称伪装真实夹具");
  await keyword.fill("不会匹配的成长中心核对关键词");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("agent")).toBe(agentId);
  await expect(page.getByRole("textbox", { name: "内容关键词", exact: true })).toHaveValue("不会匹配的成长中心核对关键词");
  await page.getByRole("button", { name: "重新读取状态", exact: true }).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get("agent")).toBe(agentId);
  await expect(page.getByRole("combobox", { name: "助手", exact: true })).toHaveValue(agentId);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
