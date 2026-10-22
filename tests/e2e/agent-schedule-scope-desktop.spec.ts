import { expect, test } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { ScheduleAgentOption } from "../../src/contracts/schedule";
import { agentScheduleHref, agentScheduleReturnHref } from "../../src/features/schedules/agent-schedule-scope";

test("桌面真实助手计划入口、范围、返回与无写预览", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const firstParsed = ScheduleAgentOption.shape.id.safeParse(process.env.AGENT_SCHEDULE_SCOPE_E2E_AGENT_ID);
  const secondParsed = ScheduleAgentOption.shape.id.safeParse(process.env.AGENT_SCHEDULE_SCOPE_E2E_OTHER_AGENT_ID);
  if (!firstParsed.success || !secondParsed.success || process.env.AGENT_SCHEDULE_SCOPE_E2E_ISOLATED !== "1") {
    throw new Error("CI须先外部核实隔离环境，再提供两个真实助手编号与 AGENT_SCHEDULE_SCOPE_E2E_ISOLATED=1；旗标不是隔离证明。需有两助手已保存的暂停计划和正式版本，不创建数据、不注入成功记录、不跳过前提。");
  }
  const first = firstParsed.data.toLowerCase(), second = secondParsed.data.toLowerCase();
  if (first === second) throw new Error("隔离夹具必须提供两个不同的真实助手。");
  const paths = [agentScheduleReturnHref(first)!, agentScheduleReturnHref(second)!];
  const scopeHrefs = [agentScheduleHref(first)!, agentScheduleHref(second)!];
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  const exports: AgentExportFile[] = [];
  for (const path of paths) {
    const response = await page.request.get("/api" + path + "/export");
    expect(response.ok()).toBe(true);
    exports.push(AgentExportFile.parse(await response.json()));
  }
  for (const [index, id] of [first, second].entries()) {
    if (exports[index].workflow.rootAgent.id.toLowerCase() !== id) throw new Error("真实助手导出来源必须对应同一隔离助手，不能用其他定义代替。");
  }
  const names = exports.map((value) => value.agent.name);
  if (names[0] === names[1]) throw new Error("隔离夹具须使用两个不同的真实助手名称，便于核对范围泄漏。");

  await page.goto("/schedules");
  const global = page.getByRole("region", { name: "全部计划", exact: true });
  await expect(global).toBeVisible();
  const baselineRows: string[][] = [];
  for (const name of names) {
    const rows = global.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });
    const count = await rows.count();
    if (count === 0) throw new Error("隔离夹具缺少某助手已保存的计划，不能把空状态当正向范围通过。");
    for (let index = 0; index < count; index++) {
      if (await rows.nth(index).getByText("已暂停", { exact: true }).count() !== 1) throw new Error("两助手夹具计划须已暂停，避免后台调度改变只读核对前像；本规格不调用暂停接口。");
    }
    baselineRows.push(await rows.allTextContents());
  }

  for (let index = 0; index < paths.length; index++) {
    await page.goto(paths[index]);
    await expect(page.getByRole("heading", { level: 1, name: names[index], exact: true })).toBeVisible();
    const entry = page.getByRole("link", { name: "管理此助手的定时任务", exact: true });
    await expect(entry).toHaveAttribute("href", scopeHrefs[index]);
    await entry.click();
    await expect(page).toHaveURL(new URL(scopeHrefs[index], page.url()).href);
    await expect(page.getByRole("heading", { level: 1, name: names[index] + "的定时任务", exact: true })).toBeVisible();
    const list = page.getByRole("region", { name: "此助手的计划", exact: true });
    await expect(list.getByRole("listitem")).toHaveCount(baselineRows[index].length);
    expect(await list.getByRole("listitem").allTextContents()).toEqual(baselineRows[index]);
    await expect(list.getByRole("heading", { level: 3, name: names[1 - index], exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "返回助手工作台", exact: true })).toHaveAttribute("href", paths[index]);
    await expect(page.getByRole("link", { name: "此助手的自动运行记录", exact: true })).toHaveAttribute("href", `/runs?source=schedule&agent=${index ? second : first}`);
    const create = page.getByRole("button", { name: "新建定时任务", exact: true });
    await expect(create).toBeEnabled();
    await create.click();
    const dialog = page.getByRole("dialog", { name: "新建定时任务", exact: true });
    const picker = dialog.getByRole("combobox", { name: "助手", exact: true });
    await expect(picker).toBeDisabled();
    await expect(picker.locator("option")).toHaveCount(1);
    await expect(picker.locator("option")).toHaveText(names[index]);
    await expect(dialog.getByText(/^当前显示：正式版本 V\d+$/)).toBeVisible();
    await expect(dialog.getByText(/所有时间按北京时间计算/)).toBeVisible();
    const localInput = dialog.getByRole("textbox").first();
    if (await localInput.count() === 0) throw new Error("真实正式版本夹具须提供一个文字或对象输入，以只在浏览器内验证字段隔离；不构造业务字段。");
    const marker = "仅本地未提交的助手范围核对";
    expect(await localInput.inputValue()).not.toContain(marker);
    await localInput.fill(marker);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await dialog.getByRole("button", { name: "关闭创建面板", exact: true }).click();
    await page.getByRole("link", { name: "返回助手工作台", exact: true }).click();
    await expect(page).toHaveURL(new URL(paths[index], page.url()).href);
    await expect(page.getByRole("heading", { level: 1, name: names[index], exact: true })).toBeVisible();
  }

  const duplicate = new URL(scopeHrefs[0], page.url());
  duplicate.searchParams.append("agent", second);
  for (const invalid of [duplicate.href, new URL("/schedules?agent=not-valid", page.url()).href]) {
    await page.goto(invalid);
    await expect(page.getByRole("heading", { name: "助手范围无效", exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("不会扩大为全部计划");
    await expect(page.getByRole("region", { name: "全部计划", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "此助手的计划", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "返回助手工作台", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "查看全部计划", exact: true })).toHaveAttribute("href", "/schedules");
  }
  await page.getByRole("link", { name: "查看全部计划", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "定时任务", exact: true })).toBeVisible();
  for (const [index, path] of paths.entries()) {
    const response = await page.request.get("/api" + path + "/export");
    expect(response.ok()).toBe(true);
    const after = AgentExportFile.parse(await response.json());
    expect(after.agent).toEqual(exports[index].agent);
    expect(after.workflow).toEqual(exports[index].workflow);
  }
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach("真实助手范围计划只读路径", { body: JSON.stringify({ assistantPaths: paths, savedPausedPlanCounts: baselineRows.map((rows) => rows.length), widths: [1280, 1440], writes, errors, externalIsolationProofRequired: true, isolationVerifiedByThisSpec: false, scheduleCreatedByThisSpec: false }, null, 2), contentType: "application/json" });
});
