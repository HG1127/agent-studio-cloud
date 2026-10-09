import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../acceptance.ps1", import.meta.url), "utf8");
const guard = readFileSync(new URL("../../scripts/check-local-acceptance.mjs", import.meta.url), "utf8");

describe("完整本地验收入口", () => {
  it("真实PowerShell入口在缺配置时立即失败，不启动数据库或测试", () => {
    if (process.platform !== "win32") return;
    const result = spawnSync("pwsh", ["-NoProfile", "-File", "acceptance.ps1"], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, NEON_PROJECT_ID: "", NEON_API_KEY: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("NEON_PROJECT_ID");
    expect(result.stdout).not.toContain("锁定依赖安装");
  });
  it.each(["passed", "skipped", "failed", "missing"])("本地真实守卫拒绝新增两项的%s异常", (status) => {
    const directory = mkdtempSync(path.join(tmpdir(), "local-guard-test-"));
    try {
      const expected = [
        ["integration", "mvp-acceptance-template-persistence", 5],
        ["integration", "mcp-registered-tool-names", 3],
        ["workflow", "mvp-acceptance-runtime", 11],
        ["workflow", "mvp-acceptance-production-template", 13],
        ["workflow", "mvp-acceptance-template-recovery", 4],
        ["workflow", "mcp-registered-tool-names", 3],
        ["workflow", "mvp-acceptance-zero-argument-read", 2],
      ] as const;
      for (const group of ["integration", "workflow"]) {
        const testResults = expected.filter(([kind]) => kind === group).map(([kind, name, count]) => ({
          name: `/repo/tests/${kind}/${name}.test.ts`,
          assertionResults: Array.from({ length: count }, () => ({ status: "passed" })),
        }));
        const assertions = testResults.find((suite) => suite.name.includes("zero-argument-read"))?.assertionResults;
        if (assertions) {
          if (status === "missing") assertions.pop();
          else assertions[0].status = status;
        }
        writeFileSync(path.join(directory, `${group}-results.json`), JSON.stringify({ success: true, testResults }));
      }
      const result = spawnSync(process.execPath, ["scripts/check-local-acceptance.mjs"], {
        encoding: "utf8", timeout: 5000, env: { ...process.env, LOCAL_ACCEPTANCE_REPORTS: directory },
      });
      expect(result.error).toBeUndefined();
      if (status === "passed") expect(result.status).toBe(0);
      else {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("真实断言缺失、跳过或失败");
      }
    } finally { rmSync(directory, { recursive: true }); }
  });
  it("公开实际存在的唯一完整入口，不提供跳过测试选项", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(manifest.scripts.acceptance).toBe("pwsh -NoProfile -File ./acceptance.ps1");
    expect(script).not.toMatch(/skipTests|skipDatabase|passWithNoTests|testNamePattern/);
  });
  it("配置缺失时在任何执行前失败，拒绝加载共享环境文件", () => {
    expect(script.indexOf('foreach ($name in @("NEON_PROJECT_ID", "NEON_API_KEY"))')).toBeLessThan(script.indexOf('Invoke-Checked "锁定依赖安装"'));
    expect(script).toContain('Test-Path -LiteralPath $file');
    expect(script).toContain('postgresql://ci:ci@127.0.0.1:1/unavailable');
  });
  it("仅迁移本次唯一分支的ci_test空库，隔离标记在迁移后设置", () => {
    expect(script).toContain("[Guid]::NewGuid()");
    expect(script).toContain('databases create --name ci_test --branch $branchName');
    expect(script).toContain('$parsedUrl.AbsolutePath -ne "/ci_test"');
    expect(script.indexOf('$env:MVP_ACCEPTANCE_ISOLATED_DB = "1"')).toBeGreaterThan(script.indexOf('Invoke-Checked "迁移本次临时空库"'));
    expect(script).toContain('$env:MVP_ACCEPTANCE_ISOLATED_DB = "0"');
  });
  it("保留全部门禁和显式helper，报告来自本次临时目录并复用CI数量守卫", () => {
    for (const value of ['"--frozen-lockfile"', '"audit"', '"tsc"', '"eslint"', '"build"', '"vitest.integration.config.mts"', '"vitest.workflow.config.mts"', 'tests/helpers/mvp-acceptance-recovery.config.mts', '"playwright", "test"']) expect(script).toContain(value);
    expect(script).toContain('$reports = Join-Path ([IO.Path]::GetTempPath()) $branchName');
    expect(guard).toContain('../.github/workflows/ci.yml');
    expect(guard).toContain('vm.runInNewContext');
    expect(guard).toContain('path.join(directory, file)');
  });
  it("创建结果未知也清理同一分支，删除失败不吞掉且环境恢复", () => {
    expect(script.indexOf('$creationAttempted = $true')).toBeLessThan(script.indexOf('branches create --name $branchName'));
    expect(script).toContain('branches delete $branchName');
    expect(script).toContain('branches list');
    expect(script).toContain('$remaining.Contains($branchName)');
    expect(script).toContain('if ($cleanupFailed) { throw');
    expect(script).toContain('[Environment]::SetEnvironmentVariable($name, $original[$name], "Process")');
    expect(script).toContain('$env:PLAYWRIGHT_REUSE_SERVER = "0"');
    expect(script).toContain('[Net.IPAddress]::Loopback, 0');
  });
});
