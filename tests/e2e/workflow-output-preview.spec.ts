import { expect, test } from "@playwright/test";
import { WorkflowOutputPreviewResult, MAX_OUTPUT_PREVIEW_BODY_BYTES } from "../../src/contracts/workflow-output-preview";
import { outputPreviewRequest, outputPreviewWorkflow } from "../fixtures/domain/workflow-output-preview";

test("交付试算实际 HTTP 支持主流程和容器成果，缺失与凭据不返回半成品", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("需要隔离测试服务地址");
  const headers = { origin: new URL(baseURL).origin, "content-type": "application/json" };
  const post = (raw: unknown) => request.post("/api/workflows/output-preview", { headers, data: JSON.stringify(raw) });
  const root = await post(outputPreviewRequest()); expect(root.status()).toBe(200); expect(root.headers()["cache-control"]).toBe("no-store");
  expect(WorkflowOutputPreviewResult.parse(await root.json())).toMatchObject({ ok: true, executed: false, scope: "final-delivery-fields", result: { 交付: { 金额: 0 } } });
  const workflow = outputPreviewWorkflow([{ path: "金额", sourceNodeId: "group.extract", sourcePath: ["amount"], required: true }]);
  const subflow = await post({ workflow, outputs: { group: { status: "completed", steps: [{ output: { amount: 0 } }] } } });
  expect(subflow.status()).toBe(200); expect(await subflow.json()).toMatchObject({ result: { 金额: 0 } });
  workflow.outputContract!.fields[0].sourceNodeId = "batch.work.extract";
  const outputs = { batch: { status: "completed_with_issues", branches: { work: { status: "completed", outputs: { "batch.work.extract": { amount: 0 } } }, other: { status: "failed", outputs: {} } } } };
  const parallel = await post({ workflow, outputs }); expect(parallel.status()).toBe(200); expect(await parallel.json()).toMatchObject({ result: { 金额: 0 } });
  outputs.batch.branches.work.status = "failed";
  const failedBranch = await post({ workflow, outputs }); expect(failedBranch.status()).toBe(422); expect(await failedBranch.json()).toMatchObject({ code: "missing_source" });
  const missing = await post({ workflow: outputPreviewWorkflow([
    { path: "金额", sourceNodeId: "extract", sourcePath: ["amount"], required: true },
    { path: "决定", sourceNodeId: "extract", sourcePath: ["approved"], required: true },
  ]), outputs: {} });
  expect(missing.status()).toBe(422); const diagnostic = WorkflowOutputPreviewResult.parse(await missing.json());
  expect(diagnostic).toMatchObject({ ok: false, executed: false, fields: [{ path: "金额", status: "missing" }, { path: "决定", status: "missing" }] }); expect(diagnostic).not.toHaveProperty("result");
  const fieldWorkflow = outputPreviewWorkflow([{ path: "金额", sourceNodeId: "extract", sourcePath: ["amount"], required: true }]);
  const safe = await post({ workflow: fieldWorkflow, outputs: { extract: { amount: 0, password: "unselected-e2e-private-value" } } }); expect(safe.status()).toBe(200); expect(await safe.text()).not.toContain("unselected-e2e-private-value");
  const unsafe = await post({ workflow: fieldWorkflow, outputs: { extract: { amount: "Bearer selected-e2e-private-value" } } }); expect(unsafe.status()).toBe(422); expect(await unsafe.text()).not.toContain("selected-e2e-private-value");
});

test("交付试算实际 HTTP 拒绝跨站、执行注入和过大请求", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("需要隔离测试服务地址");
  const headers = { origin: new URL(baseURL).origin, "content-type": "application/json" }, data = JSON.stringify(outputPreviewRequest());
  const crossSite = await request.post("/api/workflows/output-preview", { headers: { ...headers, origin: "https://foreign.example" }, data }); expect(crossSite.status()).toBe(403);
  const injected = await request.post("/api/workflows/output-preview", { headers, data: JSON.stringify({ ...outputPreviewRequest(), execute: true, inlineReferences: {} }) }); expect(injected.status()).toBe(400);
  const query = await request.post("/api/workflows/output-preview?runId=other", { headers, data }); expect(query.status()).toBe(400);
  const type = await request.post("/api/workflows/output-preview", { headers: { ...headers, "content-type": "text/plain" }, data }); expect(type.status()).toBe(415);
  const oversized = await request.post("/api/workflows/output-preview", { headers, data: "中".repeat(Math.ceil(MAX_OUTPUT_PREVIEW_BODY_BYTES / 3)) }); expect(oversized.status()).toBe(413);
  const invalidEncoding = await request.post("/api/workflows/output-preview", { headers, data: Buffer.from([0xff]) }); expect(invalidEncoding.status()).toBe(400);
  for (const response of [crossSite, injected, query, type, oversized, invalidEncoding]) {
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(WorkflowOutputPreviewResult.parse(await response.json())).toMatchObject({ ok: false, executed: false });
  }
});
