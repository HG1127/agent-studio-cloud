import { readFileSync } from "node:fs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../acceptance.ps1", import.meta.url), "utf8");
const guard = readFileSync(new URL("../../scripts/check-local-acceptance.mjs", import.meta.url), "utf8");
const commandFixture = readFileSync(new URL("../fixtures/local-acceptance-commands.ps1", import.meta.url), "utf8");

type NeonMockMode = "api" | "session-default" | "session-empty-env" | "session-env" | "session-explicit";
type MockInvocation = { kind: string; arguments: string[] };

function mockFullEntry(mode: NeonMockMode, scenario: string) {
  const directory = mkdtempSync(path.join(tmpdir(), "local-entry-mock-"));
  try {
    const entry = path.join(directory, "acceptance.ps1");
    const fixture = path.join(directory, "mock-commands.ps1");
    const calls = path.join(directory, "calls.jsonl");
    writeFileSync(entry, script);
    writeFileSync(fixture, commandFixture);
    writeFileSync(calls, "");
    const result = spawnSync("pwsh", ["-NoProfile", "-File", fixture, "-Entry", entry, "-Calls", calls, "-Mode", mode, "-Scenario", scenario], {
      encoding: "utf8", timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain("ENV-RESTORED:True");
    expect(output).not.toMatch(/local-ci-dummy-secret|fixture-oauth-token|fixture-db-secret/);
    const invocations = readFileSync(calls, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as MockInvocation);
    return { output, invocations };
  } finally {
    if (path.dirname(directory) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("local-entry-mock-")) throw new Error("非本次模拟目录");
    rmSync(directory, { recursive: true });
  }
}

function mockArgument(values: string[], name: string) {
  const index = values.indexOf(name);
  return index < 0 ? undefined : values[index + 1];
}

describe("完整本地验收入口", () => {
  it.runIf(process.platform === "win32").each(["api", "session-default", "session-empty-env", "session-env", "session-explicit"] as const)("实际完整入口%s冻结登录主体和项目并保持全部门禁", (mode) => {
    const { output, invocations } = mockFullEntry(mode, "success");
    expect(output).toContain("本地完整门禁通过");
    expect(output).not.toContain("ENTRY-FAILED");
    const neon = invocations.filter((call) => call.kind === "neon");
    const contexts = new Set(neon.map((call) => mockArgument(call.arguments, "--context-file")));
    expect(contexts.size).toBe(1);
    const context = [...contexts][0]!;
    expect(path.isAbsolute(context)).toBe(true);
    expect(path.basename(context)).toBe("neon-context.json");
    expect(path.basename(path.dirname(context))).toMatch(/^local-acceptance-[0-9a-f]{32}$/);
    for (const { arguments: values } of neon) {
      expect(values.slice(0, 2)).toEqual(["--yes", "neonctl@5.0.1"]);
      expect(values).not.toContain("--api-key");
      expect(values).not.toContain("--force-auth");
      expect(values[2]).not.toMatch(/^(auth|login|profile)$/);
      expect(values).toContain("--no-analytics");
      expect(mockArgument(values, "--api-host")).toBe("https://console.neon.tech/api/v2");
      expect(mockArgument(values, "--oauth-host")).toBe("https://oauth2.neon.tech");
      if (mode === "api") {
        expect(mockArgument(values, "--config-dir")).toBe(path.join(path.dirname(context), "neon-config"));
        expect(mockArgument(values, "--profile")).toBeUndefined();
      } else {
        expect(values).not.toContain("--config-dir");
        expect(mockArgument(values, "--profile")).toBe(mode === "session-default" || mode === "session-empty-env" ? "DEFAULT" : mode === "session-explicit" ? "chosen-profile" : "ambient-profile");
      }
      if (values[2] === "api") {
        expect(values[3]).toMatch(/^\/projects\/test-project-123(?:\/branches)?$/);
        expect(mockArgument(values, "--method")).toBe("GET");
        expect(values).not.toContain("--project-id");
      } else expect(mockArgument(values, "--project-id")).toBe("test-project-123");
    }
    const pages = neon.filter((call) => call.arguments[3].endsWith("/branches"));
    expect(pages).toHaveLength(2);
    expect(pages[0].arguments).toContain("limit=100");
    expect(pages[1].arguments).toContain("cursor=cursor-one");
    for (const page of pages) {
      expect(page.arguments).toContain("sort_by=created_at");
      expect(page.arguments).toContain("sort_order=asc");
    }
    const created = neon.find((call) => call.arguments[2] === "branches" && call.arguments[3] === "create")!;
    expect(mockArgument(created.arguments, "--name")).toMatch(/^local-acceptance-[0-9a-f]{32}$/);
    expect(created.arguments).toContain("--no-secrets");
    const removed = neon.find((call) => call.arguments[2] === "branches" && call.arguments[3] === "delete")!;
    expect(removed.arguments[4]).toBe("br-local-acceptance-test");
    const commands = invocations.filter((call) => call.kind === "pnpm" || call.kind === "node").map((call) => call.arguments.join(" ")).join("\n");
    for (const command of ["install --frozen-lockfile", "audit --prod --audit-level high", "next typegen", "tsc --noEmit", "eslint . --no-cache --max-warnings=0", "vitest run --maxWorkers=1", "mvp-acceptance-recovery.config.mts", "build", "db:migrate", "vitest.integration.config.mts", "vitest.workflow.config.mts", "scripts/check-local-acceptance.mjs", "playwright install chromium", "playwright test --workers=1"]) expect(commands).toContain(command);
    expect(invocations[0].kind).toBe("neon");
    expect(invocations[0].arguments[3]).toBe("/projects/test-project-123");
  });

  it.runIf(process.platform === "win32").each(["api", "session-empty-env"] as const)("%s不继承非官方API或OAuth端点且保留原环境", (mode) => {
    const { output, invocations } = mockFullEntry(mode, "redirected-hosts");
    expect(output).toContain("本地完整门禁通过");
    expect(output).not.toContain("ENTRY-FAILED");
    const neon = invocations.filter((call) => call.kind === "neon");
    expect(neon.length).toBeGreaterThan(0);
    for (const invocation of neon) {
      expect(mockArgument(invocation.arguments, "--api-host")).toBe("https://console.neon.tech/api/v2");
      expect(mockArgument(invocation.arguments, "--oauth-host")).toBe("https://oauth2.neon.tech");
      expect(invocation.arguments.join(" ")).not.toContain("untrusted.invalid");
    }
  });

  it.runIf(process.platform === "win32")("实际完整入口恢复受控快照中的缺失变量和空字符串变量", () => {
    const { output, invocations } = mockFullEntry("session-empty-env", "mixed-original-env");
    expect(output).toContain("本地完整门禁通过");
    expect(output).not.toContain("ENTRY-FAILED");
    expect(invocations.some((call) => call.kind === "pnpm" && call.arguments.includes("db:migrate"))).toBe(true);
    expect(invocations.some((call) => call.kind === "pnpm" && call.arguments.join(" ") === "exec playwright test --workers=1")).toBe(true);
  });

  it.runIf(process.platform === "win32").each([
    { mode: "api", scenario: "missing-key" },
    { mode: "api", scenario: "whitespace-key" },
    { mode: "api", scenario: "profile-only" },
    { mode: "api", scenario: "auth-failure" },
    { mode: "session-env", scenario: "missing-project" },
    { mode: "session-env", scenario: "missing-session" },
    { mode: "session-env", scenario: "auth-failure" },
    { mode: "session-env", scenario: "session-api-conflict" },
    { mode: "session-env", scenario: "whitespace-key" },
    { mode: "session-env", scenario: "whitespace-profile" },
    { mode: "session-explicit", scenario: "empty-explicit-profile" },
    { mode: "session-explicit", scenario: "invalid-profile" },
    { mode: "session-env", scenario: "wrong-project" },
    { mode: "session-env", scenario: "wrong-project-shape" },
    { mode: "session-env", scenario: "invalid-project-json" },
  ] as const)("实际入口$mode/$scenario在创建和重型门禁前拒绝", ({ mode, scenario }) => {
    const { output, invocations } = mockFullEntry(mode, scenario);
    expect(output).toContain("ENTRY-FAILED");
    expect(output).not.toContain("本地完整门禁通过");
    expect(invocations.every((call) => call.kind === "neon" && call.arguments[2] === "api" && call.arguments[3] === "/projects/test-project-123")).toBe(true);
    expect(invocations.filter((call) => call.arguments[3] === "create")).toHaveLength(0);
  });

  it.runIf(process.platform === "win32").each(["unknown-create", "invalid-created-json", "wrong-created-project"])("实际入口%s仍严格清理同一随机名称并保留原失败", (scenario) => {
    const { output, invocations } = mockFullEntry("session-env", scenario);
    expect(output).toContain("ENTRY-FAILED");
    expect(output).not.toContain("本地完整门禁通过");
    expect(output).not.toContain("清理未确认");
    const neon = invocations.filter((call) => call.kind === "neon");
    const create = neon.find((call) => call.arguments[3] === "create")!;
    const remove = neon.find((call) => call.arguments[3] === "delete")!;
    expect(remove.arguments[4]).toBe(mockArgument(create.arguments, "--name"));
    expect(neon.filter((call) => call.arguments[3].endsWith("/branches"))).toHaveLength(2);
    expect(invocations.some((call) => call.arguments.includes("db:migrate"))).toBe(false);
    if (scenario === "unknown-create") expect(output).toContain("退出码=7");
  });

  it.runIf(process.platform === "win32").each(["delete-failure", "both-failures", "list-exit", "invalid-list-json", "list-wrong-shape", "missing-pagination", "wrong-branch-project", "still-present-later", "renamed-id-present", "duplicate-id", "pagination-cycle", "invalid-cursor", "null-cursor", "blank-cursor", "control-cursor", "long-cursor", "cursor-only-pagination", "wrong-sort-by", "wrong-sort-order", "wrong-sort-shape", "empty-next", "page-bound"])("实际入口清理%s不把单页或普通退出码当作删除确认", (scenario) => {
    const { output, invocations } = mockFullEntry("session-env", scenario);
    expect(output).toContain("ENTRY-FAILED");
    expect(output).toContain("清理未确认");
    expect(output).not.toContain("本地完整门禁通过");
    expect(invocations.some((call) => call.kind === "neon" && call.arguments[3] === "delete")).toBe(true);
    if (scenario === "both-failures") {
      expect(output).toContain("原失败=验收失败");
      expect(output).toContain("退出码=7");
      expect(output).toContain("退出码=9");
    }
    if (scenario === "still-present-later" || scenario === "renamed-id-present" || scenario === "pagination-cycle") expect(invocations.filter((call) => call.arguments[3]?.endsWith("/branches"))).toHaveLength(2);
    if (scenario === "page-bound") expect(invocations.filter((call) => call.arguments[3]?.endsWith("/branches"))).toHaveLength(100);
  });
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
  });
  it.runIf(process.platform === "win32")("真实PowerShell入口在缺配置时立即失败，不启动数据库或测试", () => {
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
    expect(manifest.scripts["acceptance:basic"]).toBe("pwsh -NoProfile -File ./acceptance.ps1 -BasicsOnly");
    expect(script).not.toMatch(/skipTests|skipDatabase|passWithNoTests|testNamePattern/);
  });
  it("配置缺失时在任何执行前失败，拒绝加载共享环境文件", () => {
    const projectCheck = script.indexOf('GetEnvironmentVariable("NEON_PROJECT_ID", "Process")');
    expect(projectCheck).toBeGreaterThanOrEqual(0);
    expect(projectCheck).toBeLessThan(script.indexOf('Invoke-Checked "锁定依赖安装"'));
    expect(script).toContain('Test-Path -LiteralPath $file');
    expect(script).toContain('postgresql://ci:ci@127.0.0.1:1/unavailable');
  });
  it("仅迁移本次唯一分支的ci_test空库，隔离标记在迁移后设置", () => {
    expect(script).toContain("[Guid]::NewGuid()");
    expect(script).toContain('"databases", "create", "--name", "ci_test", "--branch", $createdBranchId');
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
    expect(script).toContain('"branches", "delete", $cleanupTarget');
    expect(script).toContain('Assert-NeonBranchAbsent');
    expect(script).toContain('"api", "$neonProjectPath/branches", "--method", "GET"');
    expect(script).not.toContain('branches list');
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
