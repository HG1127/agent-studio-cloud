import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
const integration = workflow.split(/^  integration:\s*$/m)[1];

describe("完整隔离验收的执行预算", () => {
  it("给扩展回归 45 分钟，但不删减迁移、数据库、实际 Workflow 或端到端测试", () => {
    expect(integration).toMatch(/timeout-minutes:\s*45\b/);
    expect(integration).toMatch(/needs:\s*ci\b/);
    const commands = ["pnpm db:migrate", "pnpm test:integration", "pnpm test:workflow", "pnpm test:e2e"];
    const offsets = commands.map((command) => integration.indexOf(command));
    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
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
  });
});
