import { describe, expect, it, vi } from "vitest";
import {
  freezePublicToolPublication, presentPublicTool, presentPublicToolCall, publicToolAdminCredentialMatches, publicToolCanonicalJson,
  publicToolHasCredentials, publicToolInputHash, publicToolInputIssue, publicToolPublicationMatches, publicToolSourceKey,
} from "./public-agent-tool";
import { PUBLIC_TOOL_TEST_IDS as ids, publicToolTestCall, publicToolTestManifest, publicToolTestPublication, publicToolTestView } from "../../../tests/fixtures/public-agent-tool";

describe("公开助手工具纯领域边界", () => {
  it("固定字符全序使嵌套和数组对象中的双 Unicode 键反向枚举保持同一内容", () => {
    const composed = "\u00e9", decomposed = "e\u0301";
    const forward = { nested: [{ [composed]: 0, [decomposed]: false }], value: null };
    const reverse = { value: null, nested: [{ [decomposed]: false, [composed]: 0 }] };
    expect(publicToolCanonicalJson(forward)).toBe(publicToolCanonicalJson(reverse));
    expect(publicToolCanonicalJson(forward)).toBe(JSON.stringify({ nested: [{ [decomposed]: false, [composed]: 0 }], value: null }));
    expect(publicToolCanonicalJson({ a: 1, Z: 2, _: 3 })).toBe('{"Z":2,"_":3,"a":1}');
    const values = [0, false, null, composed, decomposed];
    expect(publicToolCanonicalJson(values)).toBe(JSON.stringify(values));
    expect(publicToolCanonicalJson(values)).not.toBe(publicToolCanonicalJson([...values].reverse()));
    expect(forward.nested[0][composed]).toBe(0);
    expect(forward.nested[0][decomposed]).toBe(false);
  });
  it("规范等价的两个 Unicode 键和值仍各自保留，不能归一化合并", () => {
    const composed = "\u00e9", decomposed = "e\u0301";
    const original = { [composed]: "单字形式", [decomposed]: "组合形式" };
    const restored = JSON.parse(publicToolCanonicalJson(original));
    expect(Object.keys(restored)).toHaveLength(2);
    expect(restored[composed]).toBe("单字形式");
    expect(restored[decomposed]).toBe("组合形式");
    expect(publicToolInputHash({ nested: { [composed]: 0, [decomposed]: false } }))
      .toBe(publicToolInputHash({ nested: { [decomposed]: false, [composed]: 0 } }));
    expect(publicToolInputHash({ nested: { [composed]: "业务值" } }))
      .not.toBe(publicToolInputHash({ nested: { [decomposed]: "业务值" } }));
    expect(publicToolCanonicalJson({ value: composed })).not.toBe(publicToolCanonicalJson({ value: decomposed }));
  });
  it("冻结 manifest 的嵌套 Unicode 元数据重排不改变摘要或版本匹配", () => {
    const composed = "\u00e9", decomposed = "e\u0301";
    const manifest = { ...publicToolTestManifest(), requirementCoverage: { nested: [{ [composed]: 0, [decomposed]: false }] } };
    const reordered = { ...publicToolTestManifest(), requirementCoverage: { nested: [{ [decomposed]: false, [composed]: 0 }] } };
    const args = { agentId: ids.agent, versionId: ids.version, version: 1, publicationId: ids.publication, now: new Date("2026-10-12T00:00:00.000Z") };
    const publication = freezePublicToolPublication({ ...args, manifest });
    expect(freezePublicToolPublication({ ...args, manifest: reordered }).manifestHash).toBe(publication.manifestHash);
    expect(publicToolPublicationMatches(publication, reordered)).toBe(true);
    expect(publicToolPublicationMatches(publication, { ...manifest, requirementCoverage: { nested: [{ [composed]: 0 }] } })).toBe(false);
  });
  it("新增规范化助手与输入/发布摘要不调用受地区或 ICU 影响的比较器", () => {
    const manifest = publicToolTestManifest(), locale = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => { throw new Error("不允许地区比较"); });
    try {
      const publication = freezePublicToolPublication({ agentId: ids.agent, versionId: ids.version, version: 1, publicationId: ids.publication, now: new Date(), manifest });
      publicToolInputHash({ nested: { "\u00e9": 0, "e\u0301": false } });
      publicToolCanonicalJson({ nested: [{ "\u00e9": 0, "e\u0301": false }] });
      publicToolPublicationMatches(publication, manifest);
      expect(locale).not.toHaveBeenCalled();
    } finally { locale.mockRestore(); }
  });
  it("管理员凭据缺失、短值、错误或非文字时关闭入口", () => {
    const configured = "test-admin-".repeat(4);
    expect(publicToolAdminCredentialMatches(configured, configured)).toBe(true);
    for (const value of [undefined, "", "short", configured + "wrong"]) expect(publicToolAdminCredentialMatches(configured, value)).toBe(false);
    expect(publicToolAdminCredentialMatches({} as string, configured)).toBe(false);
  });
  it("请求键与页面空间分开，规范标识且不含凭据", () => {
    expect(publicToolSourceKey(ids.tool.toUpperCase(), ids.request.toUpperCase())).toBe(`public-tool:${ids.tool}:${ids.request}`);
    expect(() => publicToolSourceKey("invalid", ids.request)).toThrow();
  });
  it("等价输入摘要稳定，保留零和否定并拒绝被动数据以外结构", () => {
    expect(publicToolInputHash({ amount: 0, approved: false })).toBe(publicToolInputHash({ approved: false, amount: 0 }));
    expect(publicToolInputHash({ amount: 1, approved: false })).not.toBe(publicToolInputHash({ amount: 0, approved: false }));
    const getter = Object.defineProperty({}, "amount", { get: () => { throw new Error("不可执行"); }, enumerable: true });
    expect(() => publicToolInputHash(getter)).toThrow("工具输入无效");
  });
  it("发布冻结原版本与完整 manifest 摘要，变更内容无法沿用", () => {
    const publication = publicToolTestPublication();
    expect(publicToolPublicationMatches(publication, publicToolTestManifest())).toBe(true);
    expect(publicToolPublicationMatches(publication, { ...publicToolTestManifest(), workflowFingerprint: "changed" })).toBe(false);
    expect(publicToolInputIssue(publication, { amount: 0, approved: false })).toBeNull();
    expect(publicToolInputIssue(publication, { amount: 0, approved: false, extra: true })).not.toBeNull();
  });
  it("没有显式最终交付字段或检查被阻止的版本不能发布", () => {
    const args = { agentId: ids.agent, versionId: ids.version, version: 1, publicationId: ids.publication, now: new Date() };
    expect(() => freezePublicToolPublication({ ...args, manifest: { ...publicToolTestManifest(), outputContract: { fields: [] } } })).toThrow();
    expect(() => freezePublicToolPublication({ ...args, manifest: { ...publicToolTestManifest(), designAudit: { status: "blocked", issueCount: 1, criticalCount: 1 } } })).toThrow();
  });
  it("凭据字面量、凭据字段、循环或新发放工具密钥均拒绝", () => {
    for (const value of [{ secret: "private" }, { value: "Bearer sk-test-123456789abcdef" }, { value: "pat_" + "a".repeat(64) }]) {
      expect(publicToolHasCredentials(value)).toBe(true);
      expect(() => publicToolInputHash(value)).toThrow();
    }
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(publicToolHasCredentials(cycle)).toBe(true);
  });
  it("工具安全视图丢弃存储属性和密钥摘要", () => {
    const view = publicToolTestView();
    const row = { ...view, id: ids.tool, createdAt: new Date(view.createdAt), updatedAt: new Date(view.updatedAt),
      publication: publicToolTestPublication(), workspaceId: ids.agent, tokenHash: "private-storage-hash" };
    expect(presentPublicTool(row)).toEqual(view);
    expect(JSON.stringify(presentPublicTool(row))).not.toContain("private-storage-hash");
    expect(JSON.stringify(presentPublicTool(row))).not.toContain("manifestHash");
  });
  it("仅返回绑定原任务的成功成果，失败/等待/未知不给过程内容", () => {
    const call = publicToolTestCall();
    const run = { id: ids.run, agentId: ids.agent, versionId: ids.version, sourceType: "manual",
      sourceKey: publicToolSourceKey(ids.tool, ids.request), status: "completed", result: { delivery: { amount: 0, approved: false } } };
    expect(presentPublicToolCall(call, run)).toMatchObject({ state: "completed", resultAvailable: true, deliveryConfirmed: false, result: run.result });
    for (const status of ["failed", "cancelled", "waiting_event", "waiting_approval", "future-status"]) {
      expect(presentPublicToolCall(call, { ...run, status })).toMatchObject({ resultAvailable: false, result: null });
    }
    for (const changed of [{ versionId: ids.agent }, { sourceKey: "manual:" + ids.request }, { agentId: ids.version }]) {
      expect(presentPublicToolCall(call, { ...run, ...changed })).toMatchObject({ state: "unknown", result: null });
    }
    expect(presentPublicToolCall(call, null).state).toBe("start_unknown");
  });
  it("缺失、未选字段、凭据或超容量成果保持未确认", () => {
    const call = publicToolTestCall();
    const run = { id: ids.run, agentId: ids.agent, versionId: ids.version, sourceType: "manual",
      sourceKey: publicToolSourceKey(ids.tool, ids.request), status: "completed" };
    for (const result of [{}, { delivery: 1, hidden: "unselected" }, { delivery: { password: "private" } }, { delivery: "中".repeat(800_000) }]) {
      expect(presentPublicToolCall(call, { ...run, result })).toMatchObject({ state: "unknown", resultAvailable: false, result: null });
    }
  });
});
