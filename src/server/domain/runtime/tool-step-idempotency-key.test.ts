import { validateHeaderValue } from "node:http";
import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { validateInlineWorkflows } from "./inline-workflow";
import { prepareParallelBranches } from "./parallel-runtime";
import { prepareSubflow } from "./subflow-runtime";
import { toolStepIdempotencyKey } from "./tool-step-idempotency-key";

const identity = { runId: "run-1", nodeId: "work.登记", stepId: "step-1" };
const safeKey = /^studio-step-header:v1:[a-f0-9]{64}$/;

describe("工具步骤防重键的请求头兼容", () => {
  it("全部单字节字符与Node实际请求头校验一致，合法旧键不被改写", () => {
    for (let code = 0; code <= 255; code += 1) {
      const nodeId = `work.${String.fromCharCode(code)}`;
      const legacy = `run-1:${nodeId}:step-1`;
      let valid = true;
      try { validateHeaderValue("idempotency-key", legacy); } catch { valid = false; }
      const actual = toolStepIdempotencyKey({ ...identity, nodeId });
      if (valid) expect(actual).toBe(legacy);
      else expect(actual).toMatch(safeKey);
    }
  });
  it.each(["write", "work.write", "work.one.write", "work.café", "work.\té"])("合法旧键原样保留，不裁剪或规范化：%s", (nodeId) => {
    const value = toolStepIdempotencyKey({ ...identity, nodeId });
    expect(value).toBe(`run-1:${nodeId}:step-1`);
    expect(new Headers({ "idempotency-key": value }).get("idempotency-key")).toBe(value);
  });
  it.each(["work.登记", "work.😀", "work.\0x", "work.\rx", "work.\nx", "work.\u0001x", "work.\u007fx"])("无法发送的标识生成有界ASCII键：%s", (nodeId) => {
    const value = toolStepIdempotencyKey({ ...identity, nodeId });
    expect(value).toMatch(safeKey);
    expect(new Headers({ "idempotency-key": value }).get("idempotency-key")).toBe(value);
  });
  it("相同执行定位保持稳定，不同运行、节点和循环步骤相互隔离", () => {
    const key = toolStepIdempotencyKey(identity);
    expect(toolStepIdempotencyKey({ ...identity })).toBe(key);
    for (const change of [{ runId: "run-2" }, { nodeId: "work.查询" }, { stepId: "step-2" }]) {
      expect(toolStepIdempotencyKey({ ...identity, ...change })).not.toBe(key);
    }
  });
  it("三段标识先序列化，不能因分隔符位置不同而混为同一操作", () => {
    expect(toolStepIdempotencyKey({ runId: "a:b", nodeId: "订单", stepId: "step" }))
      .not.toBe(toolStepIdempotencyKey({ runId: "a", nodeId: "b:订单", stepId: "step" }));
  });
  it("孤立代理字符不在UTF-8转换时被替换后混同", () => {
    const keys = ["work.\ud800", "work.\ud801", "work.\ufffd"].map((nodeId) => toolStepIdempotencyKey({ ...identity, nodeId }));
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((key) => safeKey.test(key))).toBe(true);
  });
  it("固定UTF-8三段序列的摘要保持兼容", () => {
    expect(toolStepIdempotencyKey(identity)).toBe("studio-step-header:v1:f5bfb504204b424a832fb9afbf93680f4713c9fc7f36a09c8eca7ff26d834e7a");
  });
  it.each(["subflow", "parallel"] as const)("真实%s准备保留合法中文内联标识，传输键不再使用原始标识", (type) => {
    const step = { id: "登记", title: "登记", type: "tool", tool: { connector: "订单", registryToolId: "orders.save", action: "save", scope: "write", protocol: "http-json" } };
    const container = type === "subflow"
      ? { subflow: { name: "登记订单", steps: [step] } }
      : { parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "登记分支", label: "登记", steps: [step] }, { id: "other", label: "记录", steps: [{ id: "note", title: "记录", type: "system" }] },
      ] } };
    const draft = WorkflowDraft.parse({ id: "inline-headers", rootAgent: { id: "agent", name: "登记助手", role: "owner" },
      nodes: { start: { id: "start", title: "开始", type: "trigger", next: "work" }, work: { id: "work", title: "登记", type, next: "done", ...container },
        done: { id: "done", title: "完成", type: "end" } }, memoryPolicy: { taskContext: true, longTerm: false },
    });
    expect(validateInlineWorkflows(draft)).toBeNull();
    const prepared = type === "subflow" ? prepareSubflow(draft.nodes.work) : prepareParallelBranches(draft.nodes.work);
    if (!prepared.ok) throw new Error(prepared.error);
    const nodeId = "steps" in prepared ? prepared.steps[0].id : prepared.branches[0].steps[0].id;
    expect(nodeId).toContain("登记");
    expect(() => new Headers({ "idempotency-key": `run-1:${nodeId}:step-1` })).toThrow(TypeError);
    expect(toolStepIdempotencyKey({ ...identity, nodeId })).toMatch(safeKey);
  });
});
