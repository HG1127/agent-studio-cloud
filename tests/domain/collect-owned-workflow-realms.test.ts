import { describe, expect, it } from "vitest";
import { validateCollectedRealmReceipts } from "../helpers/collect-owned-workflow-realms";

const domain = "11111111-1111-4111-8111-111111111111";
const context = { version: 1, batchId: "22222222-2222-4222-8222-222222222222", caseId: "harness-retry",
  sourceCommit: "a".repeat(40), sourceFingerprint: "b".repeat(64), executionDomainId: domain,
  databaseBranchId: "br-owned-test", applicationName: "mvp_wf_" + domain.replaceAll("-", ""), sdkDirectory: "C:/owned/sdk" };
function pair(realmId = "33333333-3333-4333-8333-333333333333", poolId = "44444444-4444-4444-8444-444444444444") {
  const registration = { version: 1, context, realmId, processId: 123, threadId: 1 };
  const receipt = { executionDomainId: domain, realmId, processId: 123, threadId: 1,
    pools: { ownerId: domain, state: "callbacks_completed", poolIds: [poolId], completedIds: [poolId], failedIds: [], unknownIds: [], cleanupPermitted: false } };
  return { registration, final: { version: 1, context, receipt } };
}
describe("执行空间回执收集", () => {
  it("匹配自有进程的登记与原关闭回执", () => {
    const item = pair();
    expect(validateCollectedRealmReceipts(context, [item.registration], [item.final], new Set([123]))).toEqual([item.final.receipt]);
  });
  it("同进程线程的不同VM不合并", () => {
    const a = pair(), b = pair("55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666");
    expect(validateCollectedRealmReceipts(context, [a.registration, b.registration], [a.final, b.final], new Set([123]))).toHaveLength(2);
  });
  it("缺最终回执不能通过", () => {
    expect(() => validateCollectedRealmReceipts(context, [pair().registration], [], new Set([123]))).toThrow();
  });
  it("未观测进程不能通过", () => {
    const item = pair();
    expect(() => validateCollectedRealmReceipts(context, [item.registration], [item.final], new Set())).toThrow();
  });
  it("重复执行空间不能通过", () => {
    const item = pair();
    expect(() => validateCollectedRealmReceipts(context, [item.registration, item.registration], [item.final, item.final], new Set([123]))).toThrow();
  });
  it("跨VM重复连接池不能通过", () => {
    const a = pair(), b = pair("55555555-5555-4555-8555-555555555555");
    expect(() => validateCollectedRealmReceipts(context, [a.registration, b.registration], [a.final, b.final], new Set([123]))).toThrow();
  });
  it("不同冻结源码不能通过", () => {
    const item = pair();
    expect(() => validateCollectedRealmReceipts(context, [item.registration], [{ ...item.final, context: { ...context, sourceCommit: "c".repeat(40) } }], new Set([123]))).toThrow();
  });
});
