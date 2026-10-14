import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WorkflowOutputPreviewInput, WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { resolveWorkflowOutputPreview } from "@/server/domain/runtime/workflow-output-preview";

const document = readFileSync("docs/workflow-output-preview-http-contract.md", "utf8");
const examples = [...document.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
describe("最终交付试算文档可直接使用", () => {
  it("三个完整请求全部符合共享契约并实际成功试算", () => {
    expect(examples).toHaveLength(3);
    const results = examples.map((raw) => WorkflowOutputPreviewResult.parse(resolveWorkflowOutputPreview(WorkflowOutputPreviewInput.parse(raw))));
    expect(results[0]).toMatchObject({ ok: true, executed: false, result: { 交付: { 金额: 0, 批准: false, 邮箱: "business@example.com" } } });
    expect(results[1]).toMatchObject({ ok: true, result: { 金额: 0 } });
    expect(results[2]).toMatchObject({ ok: true, result: { 金额: 0 } });
  });
  it("文档明确无副作用、样例范围和展示容量，不冒充发布或真实交付", () => {
    for (const text of ["POST /api/workflows/output-preview", "不启动任务", "不调用模型或工具", "不生成试算历史", "不代表流程可以发布", "512KB", "256KB", "2MB", "no-store", "暂无专用前端入口"]) expect(document).toContain(text);
  });
  it("接口只经查询和领域解析，不导入数据库、执行器或前端组件", () => {
    const files = ["src/app/api/workflows/output-preview/route.ts", "src/server/queries/workflow-output-preview.ts", "src/server/domain/runtime/workflow-output-preview.ts"];
    for (const file of files) expect(readFileSync(file, "utf8")).not.toMatch(/@\/lib\/db|workflow\/api|@\/server\/actions|@\/features|@\/components|\bfetch\s*\(/);
    expect(readFileSync(files[0], "utf8")).toContain("getWorkflowOutputPreview");
    expect(readFileSync(files[2], "utf8")).toContain("projectWorkflowResult");
  });
});
