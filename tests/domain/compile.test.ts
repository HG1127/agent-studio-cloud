// 归一化说明：agt_/WF- 两条随机 id 正则同 Task 4；createdAt 归一为同型处理——当前编译器输出
// 不含 createdAt 字段，此替换为空操作，防 fixture 扩展后漂移。step_N、branch_N、verify_*、
// approval_* 等为确定性 id，不做归一。
//
// 偏差说明：任务书 Step 2 要求断言 brief 输入产出 verify_reply 与 approval_reply，但旧系统对该
// 输入实测不产出这两个节点：reply 工具未绑定（unresolved）时回执核验整段跳过；reply 的唯一入边
// 来自人工节点 confirm，previous.every(human) 直接置 businessApprovalAccepted 后 continue（该
// 门禁豁免与 unresolved 跳过均为控制方裁定 3 要求逐行保留的旧逻辑）。实测产出的是 approval_fetch
// （start→fetch 入边非人工，插入审批门禁并把 start 重接线）。因此金测按旧系统实际产出断言，
// verify_reply/approval_reply 的插入逻辑另用绑定 registryTools 的补充用例验证（期望值同样以
// 旧系统实测为准）。
import { describe, expect, it } from "vitest";
import golden1 from "../fixtures/domain/plan-golden-1.json";
import { WorkflowDraft } from "@/contracts/workflow";
import { compileModelWorkflowPlan } from "@/server/domain/compile";

function normalize(serialized: string): string {
  return serialized
    .replace(/agt_[0-9a-f]{8}/g, "agt_X")
    .replace(/WF-[0-9a-f-]+/g, "WF-X")
    .replace(/"createdAt":"[^"]*"/g, '"createdAt":"<ISO>"');
}

describe("流程编译器移植对齐金测", () => {
  it("plan-golden-1：同输入产出与旧系统一致", () => {
    const out = compileModelWorkflowPlan(golden1.input);
    if (!out) throw new Error("compileModelWorkflowPlan 不应返回 null");
    expect(() => WorkflowDraft.parse(out.workflow)).not.toThrow();
    const actual = normalize(JSON.stringify(out));
    const expected = normalize(JSON.stringify(golden1.output));
    expect(actual).toEqual(expected);
  });

  it("brief 输入：四个控制面节点与审批门禁按旧系统产出", () => {
    const out = compileModelWorkflowPlan(golden1.input);
    if (!out) throw new Error("compileModelWorkflowPlan 不应返回 null");
    const nodeIds = Object.keys(out.workflow.nodes);
    for (const id of ["not_approved", "safe_stop", "quality_review", "done"]) {
      expect(nodeIds).toContain(id);
    }
    expect(nodeIds).toContain("approval_fetch");
    expect(nodeIds).not.toContain("verify_reply");
    expect(nodeIds).not.toContain("approval_reply");
    expect(out.workflow.nodes.start.next).toBe("approval_fetch");
    expect(out.workflow.nodes.approval_fetch.next).toBe("fetch");
    expect(out.workflow.nodes.not_approved.next).toBe("quality_review");
    expect(out.workflow.nodes.safe_stop.next).toBe("quality_review");
    expect(out.workflow.nodes.quality_review.next).toBe("done");
  });

  it("action 类工具绑定后插入 verify_/approval_ 门禁（旧系统同行为）", () => {
    const input = {
      intent: {
        trigger: { value: "收到客户投诉" },
        outputs: ["处理结果清单"],
        orderedSteps: [
          { id: "fetch", title: "读取投诉记录", type: "tool", tool: { action: "read_records" } },
          { id: "reply", title: "发送回复", type: "tool", tool: { action: "send_content" } },
        ],
      },
      registryTools: [
        {
          id: "tool-read-1",
          connectorId: "crm",
          name: "read_records",
          title: "读取记录",
          suggestedScope: "crm.record.read",
          protocol: "rest-http",
          status: "active",
          risk: "low",
          operationKind: "read",
        },
        {
          id: "tool-send-1",
          connectorId: "mail",
          name: "send_content",
          title: "发送内容",
          suggestedScope: "mail.send",
          protocol: "rest-http",
          status: "active",
          risk: "high",
          operationKind: "action",
        },
      ],
    };
    const out = compileModelWorkflowPlan(input);
    if (!out) throw new Error("compileModelWorkflowPlan 不应返回 null");
    const nodes = out.workflow.nodes;
    expect(Object.keys(nodes)).toContain("verify_reply");
    expect(Object.keys(nodes)).toContain("approval_reply");
    expect(nodes.reply.next).toBe("verify_reply");
    expect(nodes.verify_reply.next).toBe("quality_review");
    expect(nodes.fetch.next).toBe("approval_reply");
    expect(nodes.approval_reply.next).toBe("reply");
    expect((nodes.reply.tool as Record<string, unknown> | undefined)?.businessApprovalAccepted).toBe(true);
  });
});
