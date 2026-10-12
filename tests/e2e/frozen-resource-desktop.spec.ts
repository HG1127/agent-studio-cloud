import { expect, test } from "@playwright/test";
import { VersionExportFile } from "../../src/contracts/version";
import { frozenWorkflowView } from "../../src/features/versions/frozen-workflow-view";

test("桌面真实冻结资源声明与所属步骤定位，刷新与范围往返不写数据", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const writes: string[] = [], errors: string[] = [];
  page.on("request", (request) => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(new URL(request.url()).pathname); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/web-tools");
  const entry = page.getByRole("link", { name: "只读核对这个版本的流程", exact: true });
  await expect(entry, "需要隔离环境真实保存的版本，不造模拟记录或跳过空数据").toBeVisible();
  const url = new URL((await entry.getAttribute("href"))!, page.url());
  expect(url.pathname).toMatch(/^\/agents\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}$/i);
  const exportPath = "/api" + url.pathname + "/export", response = await page.request.get(exportPath);
  expect(response.ok()).toBe(true); const original = VersionExportFile.parse(await response.json());
  const workflow = frozenWorkflowView(original.manifest.workflowSnapshot), nodes = Object.values(workflow.nodes);
  expect(nodes.length, "真实版本应有可核对的顶层步骤").toBeGreaterThan(0);
  const expectedRows = nodes.reduce((total, node) => total + 1 + (node.subflow?.steps.length ?? 0) + (node.parallel?.branches.reduce((count, branch) => count + branch.steps.length, 0) ?? 0), 0);
  await entry.click(); await expect(page).toHaveURL(url.href);
  const resources = page.getByRole("region", { name: "冻结的资源声明与步骤引用", exact: true });
  await expect(resources).toContainText("未检查历史权限、连接配置、资源内容或当前可用性");
  const model = resources.getByRole("region", { name: "版本模型声明", exact: true });
  await expect(model).toContainText(original.manifest.resourceSelection.model.modelId.trim() ? "历史模型名称未保存" : "所选模型未知");
  await expect(resources.getByRole("region", { name: "版本工具声明", exact: true })).toContainText("未保存工具目录快照");
  const knowledge = resources.getByRole("region", { name: "版本资料声明", exact: true });
  if (original.manifest.knowledgeSnapshot.length) await expect(knowledge).toContainText("明确保存了 " + original.manifest.knowledgeSnapshot.length + " 项");
  else await expect(knowledge).toContainText(/明确保存了 0 项|原快照未保存资料声明列表/);
  const references = resources.getByRole("group", { name: "核对步骤资源引用", exact: true });
  await expect(references).not.toHaveAttribute("open"); await references.locator("summary").click(); await expect(references).toHaveAttribute("open");
  const rows = resources.getByRole("list", { name: "冻结资源步骤列表", exact: true }).locator(":scope > li");
  await expect(rows).toHaveCount(expectedRows);
  let rowIndex = 0;
  for (const node of nodes) {
    await rows.nth(rowIndex).getByRole("button", { name: "定位所属步骤", exact: true }).click();
    await expect(page.locator("#frozen-node-title")).toHaveText(node.title || "未命名步骤");
    await expect(page.locator("#frozen-node-title")).toBeFocused();
    rowIndex += 1 + (node.subflow?.steps.length ?? 0) + (node.parallel?.branches.reduce((count, branch) => count + branch.steps.length, 0) ?? 0);
  }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await page.reload(); await expect(resources).toBeVisible(); await expect(references).not.toHaveAttribute("open");
  await references.locator("summary").click(); await expect(rows).toHaveCount(expectedRows);
  const saved = await page.request.get(exportPath); expect(saved.ok()).toBe(true);
  const after = VersionExportFile.parse(await saved.json()); expect(after.manifest).toEqual(original.manifest); expect(after.version).toEqual(original.version);
  for (const width of [1280, 1440]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.getByRole("link", { name: "返回网页工具核对", exact: true }).click();
  const versionId = url.pathname.split("/")[4]; await expect(page).toHaveURL(new RegExp("/web-tools\\?version=" + versionId + "$"));
  await expect(page.getByRole("link", { name: "只读核对这个版本的流程", exact: true })).toHaveAttribute("href", url.pathname + "?source=web-tools");
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("冻结资源真实只读范围", { body: JSON.stringify({ path: url.pathname, version: original.version.number, topSteps: nodes.length, resourceRows: expectedRows, writes, errors, rawFieldProvenance: false, currentResourceAvailability: false }, null, 2), contentType: "application/json" });
});
