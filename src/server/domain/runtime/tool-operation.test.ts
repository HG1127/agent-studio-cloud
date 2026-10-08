import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { toolOperationDecision, toolOperationKeyMaterial, toolOperationResolutionIssue, validateToolOperationReceipt } from "./tool-operation";
import { validateInputMappingReferences } from "./input-mapping";

const args = {
  node: { title: "登记订单", toolOperation: { scope: "order-create", key: { kind: "input" as const, path: ["orderId"] } } },
  workspaceId: "work", toolId: "orders", action: "create", input: { orderId: "o1" }, outputs: {},
};
const schema = { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } };
describe("业务操作防重领域规则", () => {
  it("人工核对不能改写已完成操作、抢占在执行操作、超额留档或延长防重期限", () => {
    const now = new Date(1000);
    const row = { status: "blocked" as const, leaseExpiresAt: null, retryDeadline: new Date(2000), resolutions: [] };
    expect(toolOperationResolutionIssue(row, "retry", now)).toBeNull();
    expect(toolOperationResolutionIssue({ ...row, status: "completed" }, "record-receipt", now)).toContain("不能改写");
    expect(toolOperationResolutionIssue({ ...row, leaseExpiresAt: new Date(2000) }, "retry", now)).toContain("仍在执行");
    expect(toolOperationResolutionIssue({ ...row, resolutions: Array(50).fill({}) }, "retry", now)).toContain("上限");
    expect(toolOperationResolutionIssue({ ...row, retryDeadline: now }, "retry", now)).toContain("有效期已过");
    expect(toolOperationResolutionIssue({ ...row, retryDeadline: now }, "record-receipt", now)).toBeNull();
  });
  it.each([undefined, null, "", "   ", true, {}, [], 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "a".repeat(257)])("无效标识 %s 不回显正文或误发请求", (orderId) => {
    expect(toolOperationKeyMaterial({ ...args, input: { orderId } })).toMatchObject({ ok: false, error: expect.stringContaining("业务操作标识") });
  });
  it.each([0, -1, 123, "o1", "订单一"])("保留有效业务标识的类型 %s", (orderId) => {
    expect(toolOperationKeyMaterial({ ...args, input: { orderId } })).toEqual({ ok: true, material: JSON.stringify(["work", "orders", "create", "order-create", orderId]) });
  });
  it("工作区、工具、动作及显式范围区分操作，数字与文字也不混用", () => {
    const baseline = toolOperationKeyMaterial(args);
    for (const override of [{ workspaceId: "other" }, { toolId: "other" }, { action: "other" },
      { node: { ...args.node, toolOperation: { ...args.node.toolOperation, scope: "other" } } }]) {
      expect(toolOperationKeyMaterial({ ...args, ...override })).not.toEqual(baseline);
    }
    expect(toolOperationKeyMaterial({ ...args, input: { orderId: 1 } })).not.toEqual(toolOperationKeyMaterial({ ...args, input: { orderId: "1" } }));
  });
  it("读取数组项、完整内联结果标识和固定值，不沿原型取数据", () => {
    const output = { "group.extract": { orders: [{ id: "o1" }] } };
    const node = { title: "登记订单", toolOperation: { scope: "order-create", key: { kind: "output" as const, nodeId: "group.extract", path: ["orders", "0", "id"] } } };
    expect(toolOperationKeyMaterial({ ...args, node, outputs: output })).toEqual(toolOperationKeyMaterial(args));
    expect(toolOperationKeyMaterial({ ...args, node: { ...args.node, toolOperation: { scope: "order-create", key: { kind: "literal", value: "o1" } } } })).toEqual(toolOperationKeyMaterial(args));
    expect(toolOperationKeyMaterial({ ...args, input: Object.create({ orderId: "inherited" }) })).toMatchObject({ ok: false });
  });
  it("直接调用同样拒绝保留路径和无效配置", () => {
    const node = { ...args.node, toolOperation: { scope: "order-create", key: { kind: "input" as const, path: ["__proto__"] } } };
    expect(toolOperationKeyMaterial({ ...args, node })).toMatchObject({ ok: false });
  });
  it.each([
    { status: "completed", hash: "a", lease: null, expected: "cached" },
    { status: "blocked", hash: "a", lease: null, expected: "blocked" },
    { status: "pending", hash: "a", lease: new Date(2000), expected: "busy" },
    { status: "pending", hash: "a", lease: new Date(1000), expected: "execute" },
    { status: "pending", hash: "a", lease: null, expected: "execute" },
    { status: "completed", hash: "different", lease: null, expected: "conflict" },
    { status: "blocked", hash: "different", lease: null, expected: "conflict" },
    { status: "pending", hash: "a", lease: new Date(NaN), expected: "blocked" },
  ] as const)("持久状态 $status 的请求 $hash 得到 $expected", ({ status, hash, lease, expected }) => {
    expect(toolOperationDecision({ requestHash: hash, status, leaseExpiresAt: lease }, "a", new Date(1000))).toBe(expected);
  });
  it("成功回执按冻结与当前契约检查，保存前脱敏且保留业务类型", () => {
    expect(validateToolOperationReceipt({ receiptId: "r1", amount: 0, approved: false, apiKey: "sk-private-receipt-key" }, schema, schema))
      .toEqual({ ok: true, value: { receiptId: "r1", amount: 0, approved: false, apiKey: "[已隐藏敏感信息]" } });
  });
  it.each([{ ok: false, receiptId: "r1" }, { receiptId: 123 }, [], null, { receiptId: "a".repeat(1024 * 1024) }])("不缓存错误、非法或超限回执 %s", (value) => {
    expect(validateToolOperationReceipt(value, schema, schema).ok).toBe(false);
  });
  it("当前或脱敏后的契约不匹配不能伪装为成功", () => {
    expect(validateToolOperationReceipt({ receiptId: "r1" }, schema, { type: "object", required: ["newField"] }).ok).toBe(false);
    expect(validateToolOperationReceipt({ receiptId: "r1", password: 123 }, { type: "object", properties: { password: { type: "number" } } }, schema).ok).toBe(false);
  });
  it("保存与启动门禁拒绝不存在的业务标识来源", () => {
    const draft = WorkflowDraft.parse({ id: "test", rootAgent: { id: "a", name: "测试", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      work: { id: "work", title: "登记", type: "tool", toolOperation: { scope: "create", key: { kind: "output", nodeId: "missing", path: ["id"] } } },
    } });
    expect(validateInputMappingReferences(draft)).toContain("操作防重标识引用了不存在");
    draft.nodes.extract = { id: "extract", title: "提取", type: "ai", next: null, rejectNext: null, onErrorNext: null, requirementIds: [], businessSpec: null };
    draft.nodes.work.toolOperation!.key = { kind: "output", nodeId: "extract", path: ["id"] };
    expect(validateInputMappingReferences(draft)).toBeNull();
  });
});
