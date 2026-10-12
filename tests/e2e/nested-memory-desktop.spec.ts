import { expect, test } from "@playwright/test";
import { AgentExportFile } from "../../src/contracts/agent";
import { VersionExportFile } from "../../src/contracts/version";
import { RunReportFile } from "../../src/contracts/run";
import { nestedMemoryWorkflowDefinition } from "../fixtures/nested-memory-workflow";

test("桌面组内经验配置、换序、保存与真实并行读写形成持久化证据", async ({ page }, testInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = "组内经验核对-" + Date.now();
  const { definition, marker } = nestedMemoryWorkflowDefinition(name);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/agents/new");
  await expect(page.getByRole("heading", { name: "从文件导入助手", exact: true })).toBeVisible();
  await page.getByLabel("选择助手定义文件").setInputFiles({ name: "nested-memory.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(definition)) });
  await page.waitForURL(/\/agents\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
  const agentPath = new URL(page.url()).pathname;
  const agentId = agentPath.split("/").at(-1)!;
  const inspector = page.getByRole("complementary", { name: "节点详情" });
  const locate = page.getByRole("combobox", { name: "定位流程步骤" });
  await locate.selectOption("group");
  await inspector.getByLabel("步骤组步骤 2 查找内容").fill(marker + "group");
  await inspector.getByLabel("步骤组步骤 2 最多参考条数").fill("1");
  await inspector.getByLabel("步骤组步骤 2 经验操作").selectOption("write");
  await inspector.getByLabel("步骤组步骤 2 经验操作").selectOption("read");
  await expect(inspector.getByLabel("步骤组步骤 2 查找内容")).toHaveValue(marker + "group");
  await expect(inspector.getByLabel("步骤组步骤 2 最多参考条数")).toHaveValue("1");
  const groupSource = inspector.getByLabel("步骤组步骤 3 保存内容来源");
  await expect(groupSource.getByRole("option", { name: "本组前序步骤：准备组内材料" })).toHaveAttribute("value", "group.prepare");
  await groupSource.selectOption("group.prepare");
  await inspector.getByRole("button", { name: "上移步骤组步骤 3", exact: true }).click();
  await expect(inspector.getByLabel("步骤组步骤 2 名称")).toHaveValue("保存组内材料");
  await page.getByRole("button", { name: "撤销上一步修改", exact: true }).click();
  await expect(inspector.getByLabel("步骤组步骤 2 名称")).toHaveValue("查找组内材料");
  await page.getByRole("button", { name: "重做上一步修改", exact: true }).click();
  await expect(inspector.getByLabel("步骤组步骤 2 名称")).toHaveValue("保存组内材料");
  await locate.selectOption("parallel");
  const parallelSource = inspector.getByLabel("并行工作 1 步骤 2 保存内容来源");
  await expect(parallelSource.getByRole("option", { name: "本组前序步骤：准备并行材料" })).toHaveAttribute("value", "parallel.materials.prepare");
  await expect(parallelSource.getByRole("option", { name: /另一项工作的内部记录|查找并行材料/ })).toHaveCount(0);
  await parallelSource.selectOption("parallel.materials.prepare");
  await inspector.getByLabel("并行工作 1 步骤 3 查找内容").fill(marker + "parallel");
  await inspector.getByLabel("并行工作 1 步骤 3 最多参考条数").fill("1");
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const control of [parallelSource, inspector.getByLabel("并行工作 1 步骤 3 查找内容"), inspector.getByRole("button", { name: "上移并行工作 1 步骤 3", exact: true })]) {
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest("aside")!.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { left: rect.left, right: rect.right, panelLeft: panel.left, panelRight: panel.right, hit: hit === element || element.contains(hit) };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(bounds.panelLeft - 1);
      expect(bounds.right).toBeLessThanOrEqual(bounds.panelRight + 1);
      expect(bounds.hit).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await parallelSource.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "qa/nested-memory-desktop.png" });
  }
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  const savedResponse = await page.request.get("/api" + agentPath + "/export");
  expect(savedResponse.ok()).toBe(true);
  const saved = AgentExportFile.parse(await savedResponse.json());
  expect(saved.workflow.nodes.group.subflow!.steps.map((step) => step.id)).toEqual(["prepare", "write", "read"]);
  expect(saved.workflow.nodes.group.subflow!.steps[1].memory).toEqual({ mode: "write", contentFrom: "group.prepare" });
  expect(saved.workflow.nodes.group.subflow!.steps[2].memory).toEqual({ mode: "read", query: marker + "group", limit: 1, contentFrom: "run_summary" });
  expect(saved.workflow.nodes.parallel.parallel!.branches[0].steps[1].memory).toEqual({ mode: "write", contentFrom: "parallel.materials.prepare" });
  expect(saved.workflow.nodes.parallel.parallel!.branches[1]).toEqual(definition.workflow.nodes.parallel.parallel!.branches[1]);
  await page.reload();
  await locate.selectOption("group");
  await expect(inspector.getByLabel("步骤组步骤 2 保存内容来源")).toHaveValue("group.prepare");
  await expect(inspector.getByLabel("步骤组步骤 3 查找内容")).toHaveValue(marker + "group");
  await expect(inspector.getByLabel("步骤组步骤 3 最多参考条数")).toHaveValue("1");
  await page.getByRole("button", { name: "关闭节点详情" }).last().click();
  await page.getByRole("button", { name: "发布新版本", exact: true }).click();
  await expect(page.locator("#versions").getByText("当前版本", { exact: true })).toBeVisible();
  const frozenResponse = await page.request.get((await page.locator("#versions").getByRole("link", { name: "下载此版本", exact: true }).getAttribute("href"))!);
  expect(frozenResponse.ok()).toBe(true);
  const frozen = VersionExportFile.parse(await frozenResponse.json());
  expect(frozen.manifest.workflowSnapshot.nodes.group.subflow).toEqual(saved.workflow.nodes.group.subflow);
  expect(frozen.manifest.workflowSnapshot.nodes.parallel.parallel).toEqual(saved.workflow.nodes.parallel.parallel);
  await page.getByLabel("业务输入（必填）").fill("核对本次组内保存与读取的材料记录");
  await page.getByRole("button", { name: "开始试运行", exact: true }).click();
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/);
  const runPath = new URL(page.url()).pathname;
  let report: ReturnType<typeof RunReportFile.parse> | undefined;
  await expect.poll(async () => {
    const response = await page.request.get("/api" + runPath + "/export");
    expect(response.ok()).toBe(true);
    report = RunReportFile.parse(await response.json());
    return report.run.status;
  }, { timeout: 300_000, intervals: [1000, 2000, 4000] }).toBe("completed");
  expect(report!.run.agentId).toBe(agentId);
  expect(report!.run.version).toBe(frozen.version.number);
  const evidence = [];
  for (const prefix of ["group", "parallel.materials"]) {
    const prepare = report!.steps.find((step) => step.nodeId === prefix + ".prepare")!;
    const write = report!.steps.find((step) => step.nodeId === prefix + ".write")!;
    const read = report!.steps.find((step) => step.nodeId === prefix + ".read")!;
    expect(prepare.status).toBe("succeeded");
    expect(write.status).toBe("succeeded");
    expect(write.output).toMatchObject({ mode: "write", saved: true });
    expect(read.status).toBe("succeeded");
    expect(read.output).toMatchObject({ mode: "read", query: marker + (prefix === "group" ? "group" : "parallel"), foundCount: 1 });
    const memories = (read.output as { memories: Array<{ content: string; savedAt: string }> }).memories;
    expect(memories).toHaveLength(1);
    expect(JSON.parse(memories[0].content)).toEqual(prepare.output);
    expect(Date.parse(write.finishedAt!)).toBeLessThanOrEqual(Date.parse(read.startedAt!));
    evidence.push({ prepare, write, read });
  }
  await expect(page.getByText("运行已完成", { exact: true })).toBeVisible();
  await testInfo.attach("组内与并行工作真实经验读写证据", { body: JSON.stringify({ run: report!.run.id, version: report!.run.version, evidence }, null, 2), contentType: "application/json" });
  await page.goto("/memory?" + new URLSearchParams({ agent: agentId, q: marker }));
  await expect(page.getByRole("heading", { name: "成长中心", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看来源运行", exact: true })).toHaveCount(2);
  const rows = page.locator("main li");
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) {
    await expect(row.getByRole("link", { name: "查看来源运行", exact: true })).toHaveAttribute("href", runPath);
    await row.getByText("查看完整保存内容", { exact: true }).click();
    await expect(row.locator("pre")).toContainText(marker);
  }
  expect(pageErrors).toEqual([]);
});
