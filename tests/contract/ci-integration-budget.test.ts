import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const integration = workflow.split(/^  integration:\s*$/m)[1];
const step = (name: string) => integration.split(`- name: ${name}`)[1]?.split(/\r?\n      - /)[0];

describe("完整隔离验收的执行预算", () => {
  it("给扩展真实回归 60 分钟，但不删减迁移、数据库、实际 Workflow 或端到端测试", () => {
    expect(integration).toMatch(/timeout-minutes:\s*60\b/);
    expect(integration).toMatch(/needs:\s*ci\b/);
    const commands = ["pnpm db:migrate", "pnpm exec vitest run --config vitest.integration.config.mts", "pnpm exec vitest run --config vitest.workflow.config.mts", "pnpm test:e2e"];
    const offsets = commands.map((command) => integration.indexOf(command));
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
  });

  it("隔离标记仅在本次空库迁移后的两个完整测试步骤使用", () => {
    expect(workflow.match(/MVP_ACCEPTANCE_ISOLATED_DB:/g)).toHaveLength(2);
    expect(integration.split("steps:")[0]).not.toContain("MVP_ACCEPTANCE_ISOLATED_DB");
    expect(workflow.split(/^  integration:\s*$/m)[0]).not.toContain("MVP_ACCEPTANCE_ISOLATED_DB");
    for (const name of ["隔离数据库完整集成验收", "实际 Workflow 完整验收"]) {
      const scoped = step(name);
      expect(scoped).toContain('MVP_ACCEPTANCE_ISOLATED_DB: "1"');
      expect(scoped).toContain('DATABASE_URL: ${{ env.BRANCH_URL }}');
      expect(scoped).toContain('DATABASE_URL_POOLED: ${{ env.BRANCH_URL }}');
      expect(scoped).toContain("--maxWorkers=1");
      expect(scoped).not.toMatch(/--exclude|--passWithNoTests|--testNamePattern/);
      expect(integration.indexOf(`- name: ${name}`)).toBeGreaterThan(integration.indexOf("pnpm db:migrate"));
    }
  });

  it("常规验收显式收集两项恢复假服务测试，原类型、lint、单测与构建均保留", () => {
    const regular = workflow.split(/^  integration:\s*$/m)[0];
    for (const command of ["pnpm exec tsc --noEmit", "pnpm lint", "pnpm test", "pnpm build", "pnpm exec vitest run --config tests/helpers/mvp-acceptance-recovery.config.mts --maxWorkers=1"]) {
      expect(regular).toContain(command);
    }
  });

  it("仍创建本次运行专用分支中的空库，不以共享或生产库换取速度", () => {
    expect(integration).toContain('CI_BRANCH="ci-${{ github.run_id }}-${{ github.run_attempt }}"');
    expect(integration).toContain('databases create --name ci_test --branch "$CI_BRANCH"');
    expect(integration).toContain('--database-name ci_test');
    expect(integration).toContain('DATABASE_URL: ${{ env.BRANCH_URL }}');
    expect(integration).toContain('DATABASE_URL_POOLED: ${{ env.BRANCH_URL }}');
  });

  it("失败或超时后保留受配置守卫的本次临时分支清理", () => {
    const cleanup = integration.split("- name: 删除临时分支")[1];
    expect(cleanup).toContain("if: always() && env.NEON_API_KEY != '' && vars.NEON_PROJECT_ID != ''");
    expect(cleanup).toContain('CI_BRANCH="ci-${{ github.run_id }}-${{ github.run_attempt }}"');
    expect(cleanup).toContain('branches delete "$CI_BRANCH"');
    expect(cleanup).not.toMatch(/\|\|\s*true|continue-on-error/);
    expect(integration).not.toContain("continue-on-error");
  });

  it.each(["runtime", "integration-name", "workflow-name"].flatMap((target) =>
    (["passed", "skipped", "failed", "missing"] as const).map((status) => ({ target, status })),
  ))("真实数量守卫对 $target 的 $status 使用实际 JSON 报告而非日志占位", ({ target, status }) => {
    const guard = step("核对 MVP 真实断言未缺失或跳过")!;
    const code = guard.split("node <<'NODE'")[1].split(/\r?\n\s*NODE\s*$/)[0];
    const reports = {
      "integration-results.json": {
        success: true,
        testResults: [{ name: "/repo/tests/integration/mvp-acceptance-template-persistence.test.ts", assertionResults: Array.from({ length: 5 }, () => ({ status: "passed" })) }],
      },
      "workflow-results.json": {
        success: true,
        testResults: [["runtime", 11], ["production-template", 13], ["template-recovery", 4]].map(([name, count]) => ({
          name: `/repo/tests/workflow/mvp-acceptance-${name}.test.ts`,
          assertionResults: Array.from({ length: Number(count) }, () => ({ status: "passed" })),
        })),
      },
    };
    for (const report of ["integration-results.json", "workflow-results.json"] as const) {
      const directory = report === "integration-results.json" ? "integration" : "workflow";
      reports[report].testResults.push({
        name: `/repo/tests/${directory}/mcp-registered-tool-names.test.ts`,
        assertionResults: Array.from({ length: 3 }, () => ({ status: "passed" })),
      });
    }
    const assertions = target === "integration-name"
      ? reports["integration-results.json"].testResults[1].assertionResults
      : reports["workflow-results.json"].testResults[target === "workflow-name" ? 3 : 0].assertionResults;
    if (status === "missing") assertions.pop();
    else assertions[0].status = status;
    const evaluate = () => runInNewContext(code, {
      require: () => ({ readFileSync: (file: keyof typeof reports) => JSON.stringify(reports[file]) }),
      console: { log: () => undefined },
    }, { timeout: 1000 });
    if (status === "passed") expect(evaluate).not.toThrow();
    else expect(evaluate).toThrow("真实断言缺失、跳过或失败");
  });
});
