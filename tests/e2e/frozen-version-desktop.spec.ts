import { expect, test } from "@playwright/test";
import { VersionExportFile } from "../../src/contracts/version";
import { frozenWorkflowView, frozenWorkflowGraph } from "../../src/features/versions/frozen-workflow-view";
import { outputSourceOptions } from "../../src/features/workflow-canvas/workflow-output-editing";
import { validateOutputContract } from "../../src/server/domain/runtime/output-contract";

test("桌面从网页工具核对确切冻结版本、查找复制和画布只读，全程不写草稿", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/web-tools");
  const entry = page.getByRole("link", { name: "只读核对这个版本的流程" });
  await expect(entry, "冻结版本验收需要真实正式版本，不插入模拟版本").toBeVisible();
  const url = new URL((await entry.getAttribute("href"))!, page.url());
  const match = url.pathname.match(/^\/agents\/([0-9a-f-]{36})\/versions\/([0-9a-f-]{36})$/i);
  expect(match).not.toBeNull();
  const [, agentId, versionId] = match!;
  const exportPath = "/api" + url.pathname + "/export";
  const response = await page.request.get(exportPath);
  expect(response.ok()).toBe(true);
  const originalBody = await response.json() as VersionExportFile;
  const original = VersionExportFile.parse(originalBody);
  const workflow = frozenWorkflowView(original.manifest.workflowSnapshot, originalBody.manifest.workflowSnapshot);
  const graph = frozenWorkflowGraph(workflow, false);
  const savedNodes = Object.values(workflow.nodes);
  expect(savedNodes.length, "应有真实保存的顶层步骤").toBeGreaterThan(0);
  await entry.click();
  await expect(page).toHaveURL(url.href);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("版本 " + original.version.number);
  await expect(page.getByRole("navigation", { name: "当前位置" })).toContainText("冻结版本核对");
  await expect(page.getByRole("region", { name: "冻结版本范围" })).toContainText("不是正式发布时间");
  const list = page.getByRole("list", { name: "冻结步骤列表" });
  await expect(list.getByRole("button")).toHaveCount(savedNodes.length);
  await expect(page.locator(".react-flow__node")).toHaveCount(savedNodes.length);
  await expect(page.locator(".react-flow__edge")).toHaveCount(graph.edges.length);
  for (const [index, node] of savedNodes.entries()) {
    await expect(list.getByRole("button").nth(index)).toContainText(node.title || "未命名步骤");
  }
  const chosenIndex = Math.max(0, savedNodes.findIndex((node) => node.type === "ai"));
  const chosen = savedNodes[chosenIndex];
  const chosenTitle = chosen.title || "未命名步骤";
  const button = list.getByRole("button").nth(chosenIndex);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toBeFocused();
  const details = page.getByRole("region", { name: chosenTitle, exact: true });
  await expect(details.getByRole("heading", { name: chosenTitle, exact: true })).toBeVisible();
  const contracts = details.getByRole("region", { name: "冻结字段约定只读核对", exact: true });
  await expect(contracts).toBeVisible();
  await expect(contracts).toContainText("不保存、试算或运行");
  await expect(contracts.getByRole("textbox")).toHaveCount(0);
  await expect(contracts.getByRole("button", { name: /编辑|保存|应用|试算|运行/ })).toHaveCount(0);
  if (!chosen.modelOutput) await expect(contracts).toContainText("未保存模型结果字段约定");
  else {
    if (!Object.hasOwn(chosen.modelOutput, "providerMode")) await expect(contracts).toContainText("未保存请求方式，不以默认方式替代原定义");
    if (!Object.hasOwn(chosen.modelOutput, "maxRepairAttempts")) await expect(contracts).toContainText("未保存额外修正次数，不补写默认次数");
    if (chosen.modelOutput.maxRepairAttempts === 0) await expect(contracts).toContainText("不作额外格式修正");
  }
  if (!chosen.inputMapping) await expect(contracts).toContainText("未保存输入映射");
  const search = page.getByRole("searchbox", { name: "按保存的名称或说明查找" });
  await search.fill("没有这种冻结步骤");
  await expect(page.getByRole("status")).toContainText("不表示流程为空");
  await expect(page.locator(".react-flow__node")).toHaveCount(savedNodes.length);
  await expect(details).toBeVisible();
  await page.getByRole("button", { name: "清除步骤查找" }).click();
  await expect(list.getByRole("button")).toHaveCount(savedNodes.length);
  const developer = details.getByRole("group", { name: "脱敏冻结步骤设置" });
  await expect(developer.locator("summary")).toBeVisible();
  await developer.locator("summary").focus();
  await expect(developer.locator("summary")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(developer).toHaveAttribute("open");
  await expect(developer.getByLabel("冻结步骤设置内容")).toHaveText(JSON.stringify(chosen, null, 2));
  await developer.getByRole("button", { name: "复制脱敏步骤设置" }).click();
  await expect(developer.getByRole("status")).toContainText("已复制");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.replace(/\r\n/g, "\n")).toBe(JSON.stringify(chosen, null, 2));
  expect(JSON.parse(clipboard)).toEqual(chosen);
  await expect(page.getByRole("region", { name: "冻结的业务输入约定" }).locator("li")).toHaveCount(original.manifest.inputContract.fields.length);
  const outputRegion = page.getByRole("region", { name: "冻结的最终交付约定" });
  const outputFields = original.manifest.outputContract?.fields ?? [];
  const outputRows = outputRegion.getByRole("list", { name: "冻结交付字段列表", exact: true }).locator(":scope > li");
  if (outputFields.length) await expect(outputRows).toHaveCount(outputFields.length);
  else await expect(outputRegion.getByRole("list", { name: "冻结交付字段列表", exact: true })).toHaveCount(0);
  const sources = outputSourceOptions(workflow.nodes);
  for (const [index, field] of outputFields.entries()) {
    const row = outputRows.nth(index);
    const source = sources.find((option) => option.node.id === field.sourceNodeId);
    if (source) {
      await row.getByRole("button", { name: "定位来源：" + (source.label || "未命名步骤"), exact: true }).click();
      await expect(page.getByRole("region", { name: workflow.nodes[source.ownerId].title || "未命名步骤", exact: true }).getByRole("heading").first()).toBeFocused();
    } else await expect(row.getByText(field.sourceNodeId ? "已保存来源关联，但未找到对应步骤。" : "未保存来源步骤关联，不从字段路径猜测。", { exact: true })).toBeVisible();
    if (field.sourceNodeId && validateOutputContract([field], workflow.nodes)) {
      await expect(row).toContainText("保存的来源取值约定无法按当前规则核对");
    } else if (field.sourcePath?.length) {
      const layers = row.getByRole("list", { name: `交付 ${index + 1} 冻结来源层级`, exact: true }).getByRole("listitem");
      await expect(layers).toHaveCount(field.sourcePath.length);
      for (const [position, segment] of field.sourcePath.entries()) await expect(layers.nth(position)).toHaveText(`第 ${position + 1} 层：${segment}`);
    } else await expect(row).toContainText("取值：整个步骤结果。不从交付位置推测子字段。");
  }
  await button.click();
  const hasSavedPositions = savedNodes.some((node) => workflow.ui.positions[node.id]);
  if (hasSavedPositions) {
    await page.getByRole("button", { name: "整理查看布局" }).click();
    await page.getByRole("button", { name: "返回快照布局" }).click();
  } else {
    await expect(page.getByLabel("快照布局说明", { exact: true })).toHaveText("没有保存的步骤位置");
    await expect(page.getByRole("button", { name: "没有保存的步骤位置", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "整理查看布局", exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "放大只读画布" }).click();
  await page.getByRole("button", { name: "缩小只读画布" }).click();
  await page.getByRole("button", { name: "适应画布" }).click();
  const selectedNode = page.locator(".react-flow__node").filter({ has: page.getByText(chosenTitle, { exact: true }) }).first();
  await selectedNode.scrollIntoViewIfNeeded();
  const beforeStyle = await selectedNode.getAttribute("style");
  const before = await selectedNode.boundingBox();
  expect(before).not.toBeNull();
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  await page.mouse.move(before!.x + before!.width / 2 + 45, before!.y + before!.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  await expect(selectedNode).toHaveAttribute("style", beforeStyle!);
  await selectedNode.focus();
  await page.keyboard.press("Delete");
  await expect(page.locator(".react-flow__node")).toHaveCount(savedNodes.length);
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  if (process.env.CAPTURE_UI_AUDIT === "1") {
    await page.getByRole("region", { name: "已冻结的流程" }).evaluate((element) => {
      window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 80);
    });
    await expect(page.getByRole("banner")).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: "qa/frozen-version-canvas-desktop.png" });
    await details.evaluate((element) => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 80));
    await expect(details.getByRole("heading", { name: chosenTitle, exact: true })).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.screenshot({ path: "qa/frozen-version-details-desktop.png" });
  }
  await expect(page.getByRole("button", { name: /保存草稿|发布.*版本|开始运行|删除步骤/ })).toHaveCount(0);
  const afterResponse = await page.request.get((await page.getByRole("link", { name: "下载原版本定义" }).getAttribute("href"))!);
  expect(afterResponse.ok()).toBe(true);
  expect(afterResponse.headers()["content-disposition"]).toContain("attachment");
  const afterBody = await afterResponse.json() as VersionExportFile;
  const after = VersionExportFile.parse(afterBody);
  expect(afterBody.manifest).toEqual(originalBody.manifest);
  expect(after.manifest).toEqual(original.manifest);
  expect(after.version.number).toBe(original.version.number);
  expect(after.version.createdAt).toBe(original.version.createdAt);
  await expect(page.getByRole("link", { name: "返回网页工具核对" })).toHaveAttribute("href", "/web-tools?version=" + versionId);
  await page.getByRole("link", { name: "返回网页工具核对" }).click();
  await expect(page).toHaveURL(new RegExp("/web-tools\\?version=" + versionId + "$"));
  await expect(page.getByRole("link", { name: "只读核对这个版本的流程" })).toHaveAttribute("href", `/agents/${agentId}/versions/${versionId}?source=web-tools`);
  expect(writes).toEqual([]);
});

test("桌面冻结版本保留历史范围，失效与非法返回不切换到其他版本", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.headers()["next-action"]) writes.push(new URL(request.url()).pathname);
  });
  await page.goto("/web-tools");
  const entry = page.getByRole("link", { name: "只读核对这个版本的流程" });
  await expect(entry).toBeVisible();
  const url = new URL((await entry.getAttribute("href"))!, page.url());
  const parts = url.pathname.split("/");
  const agentId = parts[2], versionId = parts[4];
  await page.goto(url.pathname + "?versionsPage=3&archivedCasesPage=2&evaluationRunsPage=4");
  await expect(page.getByRole("heading", { name: "已冻结的流程" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回版本历史" })).toHaveAttribute("href",
    `/agents/${agentId}?versionsPage=3&archivedCasesPage=2&evaluationRunsPage=4#versions`);
  await page.goto(url.pathname + "?source=" + encodeURIComponent("https://evil.example"));
  await expect(page.locator("main").getByRole("alert")).toContainText("返回范围无效");
  await expect(page.getByRole("heading", { name: "已冻结的流程" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回版本第一页" })).toHaveAttribute("href", `/agents/${agentId}#versions`);
  expect(new URL(page.url()).pathname).toBe(`/agents/${agentId}/versions/${versionId}`);
  await page.goto(`/agents/${agentId}/versions/not-a-version`);
  await expect(page.getByRole("heading", { name: "没有找到这个版本" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "已冻结的流程" })).toHaveCount(0);
  await page.goto(`/agents/${agentId}/versions/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { name: "没有找到这个版本" })).toBeVisible();
  await expect(page.getByText(/不会自动选择其他版本/)).toBeVisible();
  await expect(page.getByRole("link", { name: "返回助手列表" })).toHaveAttribute("href", "/agents");
  expect(writes).toEqual([]);
});
