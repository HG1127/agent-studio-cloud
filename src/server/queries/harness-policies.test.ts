import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { HarnessPolicyDataError, presentHarnessPolicy } from "@/server/domain/harness/management";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/services/harness-policies", () => ({ readWorkspaceHarnessPolicy: mocks.read }));
import { getHarnessPolicyQuery } from "./harness-policies";
import { validateHarnessPolicyQuery } from "./validate-harness-policy";
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(presentHarnessPolicy(null)); });
describe("后端运行规则查询与无副作用校验", () => {
  it("读取工作区身份仅由服务端提供", async () => {
    expect(await getHarnessPolicyQuery()).toEqual({ ok: true, policy: presentHarnessPolicy(null) });
    expect(mocks.read).toHaveBeenCalledWith(expect.anything(), DEMO_WORKSPACE_ID);
  });
  it("非法持久配置不泄露正文或成为空规则", async () => {
    mocks.read.mockRejectedValue(new HarnessPolicyDataError());
    expect(await getHarnessPolicyQuery()).toMatchObject({ ok: false });
  });
  it("校验明确覆盖范围且不读取数据库", async () => {
    expect(await validateHarnessPolicyQuery({ version: 1, rules: [] })).toEqual({ ok: true, policy: { version: 1, rules: [] }, coverage: "deterministic-rules-only" });
    expect(await validateHarnessPolicyQuery(null)).toMatchObject({ ok: true, policy: null });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("凭据或旧审批规则拒绝且不返回原文", async () => {
    const result = await validateHarnessPolicyQuery({ version: 1, rules: [{ id: "deny", effect: "deny", when: { scope: "password=private-password" } }] });
    expect(result).toMatchObject({ ok: false }); expect(JSON.stringify(result)).not.toContain("private-password");
    expect(await validateHarnessPolicyQuery({ version: 1, rules: [{ id: "old", effect: "require_approval", when: {} }] })).toMatchObject({ ok: false });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
