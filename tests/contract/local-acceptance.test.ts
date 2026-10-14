import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../acceptance.ps1", import.meta.url), "utf8");
const guard = readFileSync(new URL("../../scripts/check-local-acceptance.mjs", import.meta.url), "utf8");

describe("完整本地验收入口", () => {
  it.runIf(process.platform === "win32").each(["cli-session", "api-key"])("真实入口的%s认证选择保留隔离与清理", (mode) => {
    const directory = mkdtempSync(path.join(tmpdir(), "neon-auth-entry-"));
    try {
      const entry = path.join(directory, "acceptance.ps1");
      writeFileSync(entry, script);
      const command = `
$ErrorActionPreference = 'Stop'
$global:neonCalls = @()
function git { $global:LASTEXITCODE = 0; if ($args[0] -eq 'rev-parse') { 'mock-frozen-head' } }
function pnpm { $global:LASTEXITCODE = 0 }
function npx {
  $global:neonCalls += ,@{ args=@($args); profile=$env:NEON_PROFILE }
  $global:LASTEXITCODE = if ($args -contains 'create') { 7 } else { 0 }
  if ($args -contains 'list') { '[]' }
}
$env:NEON_PROJECT_ID = 'dedicated-test-project'
$env:NEON_API_KEY = if ('${mode}' -eq 'api-key') { 'dummy-test-key' } else { '' }
$env:NEON_PROFILE = 'owned-cli-profile'
$env:DATABASE_URL = 'original-unconfirmed-value'
$failed = $false
try { & '${entry.replaceAll("'", "''")}' } catch { $failed = $true }
Write-Output ('RESULT:' + (@{ failed=$failed; calls=$global:neonCalls; profile=$env:NEON_PROFILE; restored=($env:DATABASE_URL -eq 'original-unconfirmed-value') } | ConvertTo-Json -Depth 5 -Compress))
`;
      const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8", timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout + result.stderr).not.toContain("dummy-test-key");
      const record = JSON.parse(result.stdout.split("RESULT:")[1].trim());
      expect(record.failed).toBe(true);
      expect(record.restored).toBe(true);
      expect(record.profile).toBe("owned-cli-profile");
      expect(record.calls).toHaveLength(3);
      const branchNames = record.calls.map((call: { args: string[] }) => {
        expect(call.args).toContain("--project-id");
        expect(call.args).toContain("dedicated-test-project");
        expect(call.args).not.toContain("--api-key");
        expect(call.args.includes("--config-dir")).toBe(mode === "api-key");
        return call.args.find((arg: string) => arg.startsWith("local-acceptance-"));
      });
      expect(branchNames[0]).toMatch(/^local-acceptance-[a-f0-9]{32}$/);
      expect(branchNames[1]).toBe(branchNames[0]);
      expect(record.calls[0].args).toContain("create");
      expect(record.calls[1].args).toContain("delete");
      expect(record.calls[2].args).toContain("list");
      for (const call of record.calls) expect(call.profile ?? "").toBe(mode === "api-key" ? "" : "owned-cli-profile");
    } finally { rmSync(directory, { recursive: true }); }
  }, 15_000);
  it.runIf(process.platform === "win32").each(["success", "audit-failure", "dirty", "env-file"])("实际基础入口%s不需要Neon且绝不进入库路径", (scenario) => {
    const directory = mkdtempSync(path.join(tmpdir(), "basic-entry-test-"));
    try {
      const entry = path.join(directory, "acceptance.ps1");
      const calls = path.join(directory, "calls.txt");
      writeFileSync(entry, script);
      if (scenario === "env-file") writeFileSync(path.join(directory, ".env.local"), "DUMMY=1");
      const command = `
$ErrorActionPreference = 'Stop'
function git {
  $global:LASTEXITCODE = 0
  if ($args[0] -eq 'rev-parse') { Write-Output 'mock-frozen-head' }
  if ($args[0] -eq 'status' -and '${scenario}' -eq 'dirty') { Write-Output ' M fixture' }
}
function pnpm {
  Add-Content -LiteralPath '${calls.replaceAll("'", "''")}' -Value ('pnpm:' + ($args -join ' '))
  if ($env:DATABASE_URL -ne 'postgresql://ci:ci@127.0.0.1:1/unavailable' -or $env:MODEL_MOCK -ne '1' -or $env:MVP_ACCEPTANCE_ISOLATED_DB -ne '0') { throw '基础环境不安全' }
  $global:LASTEXITCODE = if ('${scenario}' -eq 'audit-failure' -and $args[0] -eq 'audit') { 9 } else { 0 }
}
function npx { Add-Content -LiteralPath '${calls.replaceAll("'", "''")}' -Value 'FORBIDDEN:neon'; throw '禁止Neon' }
function node { Add-Content -LiteralPath '${calls.replaceAll("'", "''")}' -Value 'FORBIDDEN:guard'; throw '禁止实际守卫' }
$env:NEON_API_KEY = ''; $env:NEON_PROJECT_ID = ''
$env:DATABASE_URL = 'original-unconfirmed-value'
try { & '${entry.replaceAll("'", "''")}' -BasicsOnly } catch { Write-Output 'ENTRY-FAILED' }
Write-Output ('ENV-RESTORED:' + ($env:DATABASE_URL -eq 'original-unconfirmed-value'))
`;
      const result = spawnSync("pwsh", ["-NoProfile", "-Command", command], { encoding: "utf8", timeout: 10_000 });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("ENV-RESTORED:True");
      let recorded = "";
      try { recorded = readFileSync(calls, "utf8"); } catch { /* preflight must not invoke commands */ }
      expect(recorded).not.toMatch(/FORBIDDEN|db:migrate|integration|workflow.config|playwright/);
      if (scenario === "success") {
        for (const expected of ["install --frozen-lockfile", "audit --prod --audit-level high", "next typegen", "tsc --noEmit", "eslint .", "vitest run", "mvp-acceptance-recovery.config.mts", "pnpm:build"]) expect(recorded).toContain(expected);
        expect(result.stdout).toContain("仅基础门禁通过；完整验收未执行");
        expect(result.stdout).not.toContain("本地完整门禁通过");
      } else {
        expect(result.stdout).toContain("ENTRY-FAILED");
        expect(result.stdout).not.toContain("仅基础门禁通过");
        expect(recorded).not.toContain("pnpm:build");
        if (scenario === "audit-failure") expect(result.stdout).toContain("阶段=生产依赖审计；分类=external-command；退出码=9");
        else expect(recorded).toBe("");
      }
    } finally { rmSync(directory, { recursive: true }); }
  });
  it.runIf(process.platform === "win32").each([
    { command: "Invoke-NeonQuiet", label: "创建临时分支", code: 7 },
    { command: "Invoke-NeonQuiet", label: "严格删除本次临时分支", code: 9 },
    { command: "Invoke-Checked", label: "完整单测", code: 13 },
  ])("实际PowerShell函数保留$label失败阶段及退出码并隐藏凭据", ({ command, label, code }) => {
    const source = path.resolve("acceptance.ps1").replaceAll("'", "''");
    const invocation = command === "Invoke-NeonQuiet"
      ? `Invoke-NeonQuiet '${label}' @('branches', 'create')`
      : `Invoke-Checked '${label}' 'pnpm' @('test')`;
    const codeText = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${source}', [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw '解析失败' }
foreach ($name in @('Set-Stage','Invoke-NeonQuiet','Invoke-Checked')) {
  $fn = $ast.Find({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq $name }, $true)
  Invoke-Expression $fn.Extent.Text
}
function npx { $global:LASTEXITCODE = ${code}; Write-Output 'local-ci-dummy-secret' }
function pnpm { $global:LASTEXITCODE = ${code}; Write-Output 'local-ci-dummy-secret' }
$env:NEON_API_KEY = 'local-ci-dummy-secret'
$rejected = $false
try { ${invocation} } catch { $rejected = $true }
Write-Output ('RESULT:' + (@{ rejected=$rejected; stage=$stage; category=$failureCategory; exitCode=$failureExitCode } | ConvertTo-Json -Compress))
`;
    const result = spawnSync("pwsh", ["-NoProfile", "-Command", codeText], { encoding: "utf8", timeout: 10_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("local-ci-dummy-secret");
    const record = JSON.parse(result.stdout.split("RESULT:")[1].trim());
    expect(record.rejected).toBe(true);
    expect(record.stage).toBe(label);
    expect(record.exitCode).toBe(code);
  }, 15_000);
  it.runIf(process.platform === "win32")("真实PowerShell入口在缺配置时立即失败，不启动数据库或测试", () => {
    const result = spawnSync("pwsh", ["-NoProfile", "-File", "acceptance.ps1"], {
      encoding: "utf8", timeout: 10_000,
      env: { ...process.env, NEON_PROJECT_ID: "", NEON_API_KEY: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("NEON_PROJECT_ID");
    expect(result.stdout).not.toContain("锁定依赖安装");
  }, 15_000);
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
    expect(manifest.scripts["acceptance:basic"]).toBe("pwsh -NoProfile -File ./acceptance.ps1 -BasicsOnly");
    expect(script).not.toMatch(/skipTests|skipDatabase|passWithNoTests|testNamePattern/);
  });
  it("配置缺失时在任何执行前失败，拒绝加载共享环境文件", () => {
    const projectPreflight = script.indexOf('foreach ($name in @("NEON_PROJECT_ID"))');
    expect(projectPreflight).toBeGreaterThanOrEqual(0);
    expect(projectPreflight).toBeLessThan(script.indexOf('Invoke-Checked "锁定依赖安装"'));
    expect(script).toContain('Test-Path -LiteralPath $file');
    expect(script).toContain('postgresql://ci:ci@127.0.0.1:1/unavailable');
  });
  it("仅迁移本次唯一分支的ci_test空库，隔离标记在迁移后设置", () => {
    expect(script).toContain("[Guid]::NewGuid()");
    expect(script).toContain('"databases", "create", "--name", "ci_test", "--branch", $branchName');
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
    expect(script.indexOf('$creationAttempted = $true')).toBeLessThan(script.indexOf('"branches", "create", "--name", $branchName'));
    expect(script).toContain('"branches", "delete", $branchName');
    expect(script).toContain('branches list');
    expect(script).toContain('$remaining.Contains($branchName)');
    expect(script).toContain('if ($cleanupFailed) { throw');
    expect(script).toContain('[Environment]::SetEnvironmentVariable($name, $original[$name], "Process")');
    expect(script).toContain('$env:PLAYWRIGHT_REUSE_SERVER = "0"');
    expect(script).toContain('[Net.IPAddress]::Loopback, 0');
  });
  it("失败阶段和原错误分类保留，但不输出原异常和管理凭据", () => {
    expect(script).toContain('阶段=$stage；分类=$failureCategory；退出码=$exitDescription');
    expect(script).toContain('原失败=$failure');
    expect(script).not.toContain('"--api-key"');
    expect(script).toContain('neonctl@5.0.1');
    expect(script).toContain('$env:NEON_PROFILE = $null');
    const rawExceptionOutput = /Write-Host\s+\$_|\$failure\s*=\s*\$_/;
    expect("Write-Host $_").toMatch(rawExceptionOutput);
    expect("$failure = $_").toMatch(rawExceptionOutput);
    expect("Write-Host $failure").not.toMatch(rawExceptionOutput);
    expect("$failure = 'safe stage'").not.toMatch(rawExceptionOutput);
    expect(script).not.toMatch(rawExceptionOutput);
  });
});
