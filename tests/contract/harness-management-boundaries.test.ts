import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("运行规则最小管理源码边界", () => {
  it("纯域无数据库、网络、环境变量或 Workflow I/O", () => {
    expect(source("src/server/domain/harness/management.ts")).not.toMatch(/@\/lib\/|@\/db\/|from ["']workflow|\bfetch\s*\(|process\.env/);
    expect(source("src/server/queries/validate-harness-policy.ts")).not.toMatch(/@\/lib\/db|workflow\/api|@\/server\/actions|\bfetch\s*\(/);
  });
  it("快照列可空无默认，配置和变更具业务归属及防重索引", () => {
    const runs = source("src/db/schema/runs.ts");
    expect(runs).toMatch(/harnessPolicySnapshot: jsonb\("harness_policy_snapshot"\)\.\$type<HarnessPolicySnapshot>\(\),/);
    const schema = source("src/db/schema/harness-policies.ts");
    for (const field of ["workspace_id", "created_by", "created_at", "updated_at", "archived_at"]) expect(schema.split(field)).toHaveLength(3);
    for (const index of ["harness_policies_workspace_unique", "harness_policy_changes_workspace_request_unique", "harness_policy_changes_workspace_revision_unique"]) expect(schema).toContain(index);
  });
  it("冻结与原CAS在同一初始化事务，仅重入已 running 时跳过", () => {
    const initialize = source("src/server/steps/run-state.ts").split("export type PersistStepStatus")[0];
    expect(initialize).toMatch(/db\.transaction\(async \(tx\) =>/);
    expect(initialize.indexOf('locked.status === "running"')).toBeLessThan(initialize.indexOf("await freezeRunHarnessPolicy(tx, locked, now)"));
    for (const term of ["RunExecutionClaim.parse", "lockedIssue", "RUN_START_LEASE_KEY", 'eq(runs.status, "queued")', "eq(runs.workspaceId, run.workspaceId)", "eq(runs.workflowRunId, claim.sdkRunId)", "harnessPolicySnapshot"]) expect(initialize).toContain(term);
    expect(initialize.indexOf("await freezeRunHarnessPolicy")).toBeLessThan(initialize.indexOf("return tx.update(runs)"));
  });
  it("模型与工具原guard仍早于外部调用，guard无模型工具重跑", () => {
    const model = source("src/server/steps/model-step.ts"), tool = source("src/server/steps/tool-step.ts");
    expect(model.indexOf("await enforceHarnessPolicy")).toBeLessThan(model.indexOf("await generate"));
    expect(tool.indexOf("await enforceHarnessPolicy")).toBeLessThan(tool.indexOf("await invokeRegisteredTool"));
    const guard = source("src/server/steps/harness-policy-step.ts");
    expect(guard).toContain("if (decision.allowed)"); expect(guard).toContain("readRunHarnessPolicy(args.runId)");
    expect(guard).not.toMatch(/runModelStep|runToolStep|invokeRegisteredTool|generateText|generateObject/);
  });
  it("工作区身份不能由动作输入指定，设计明确旧能力与验收边界", () => {
    const action = source("src/server/actions/save-harness-policy.ts");
    expect(action).toContain("saveManagedHarnessPolicy(parsed.data, DEMO_WORKSPACE_ID, DEMO_USER_ID)");
    const docs = source("docs/specs/2026-09-20-cloud-rebuild-nextjs-neon-vercel-design.md").split("## 25.")[1];
    for (const term of ["require_approval", "observe", "null", "历史", "管理员", "语义安全", "中央 CI", "前端"]) expect(docs).toContain(term);
  });
  it("真实回归先确认隔离库再加载 I/O，未收敛不以取消确认清理", () => {
    for (const file of ["tests/integration/harness-policies.test.ts", "tests/workflow/harness-policy-management.test.ts"]) {
      const text = source(file);
      expect(text).not.toMatch(/import\s+[^;]+\s+from\s+["'](?:@\/lib\/db|@\/server\/services\/harness-policies|workflow\/api|\.\/harness-policy-management\.workflow)["']/);
      expect(text).toContain('process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1"');
      expect(text.indexOf("process.env.MVP_ACCEPTANCE_ISOLATED_DB")).toBeLessThan(text.indexOf('await import("@/lib/db")'));
      expect(text).toContain("if (!isolatedDbReady");
    }
    const workflow = source("tests/workflow/harness-policy-management.test.ts");
    expect(workflow).not.toMatch(/\.cancel\s*\(/);
    expect(workflow).toContain("if (producers.length > 0)");
    expect(workflow.indexOf("if (producers.length > 0)")).toBeLessThan(workflow.indexOf("await db.delete("));
    const start = workflow.split("async function startProbe")[1].split("async function save")[0];
    expect(start.indexOf("producers.push(producer)")).toBeLessThan(start.indexOf("await start("));
    expect(workflow).toContain('if (await handle.status === "failed") producer.terminalObserved = true');
    expect(workflow).not.toContain("producer.settled");
    expect(workflow).not.toContain('handle.status === "cancelled"');
  });
});
