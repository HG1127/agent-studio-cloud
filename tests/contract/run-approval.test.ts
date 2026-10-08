import { describe, expect, it } from "vitest";
import { RunApprovalDecisionBody, RunApprovalDecisionInput, RunApprovalListInput, RunApprovalListResult } from "@/contracts/run-approval";
import { RunTaskStartResult } from "@/contracts/run-task";
import { runTaskLinks } from "@/server/domain/runtime/run-task";

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPROVAL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("程序化审批共享契约", () => {
  it("任务回执提供本次审批列表入口，兼容旧回执但拒绝跨任务链接", () => {
    const links = runTaskLinks(RUN);
    expect(links.approvals).toBe(`/api/runs/${RUN}/approvals`);
    expect(RunTaskStartResult.safeParse({ ok: true, runId: RUN, links: { ...links, approvals: `/api/runs/${APPROVAL}/approvals` } }).success).toBe(false);
    const { approvals: omitted, ...legacy } = links;
    expect(omitted).toBeTruthy();
    expect(RunTaskStartResult.safeParse({ ok: true, runId: RUN, links: legacy }).success).toBe(true);
  });
  it("必须明确确认，路径标识规范化，备注保留原文供服务端核对", () => {
    expect(RunApprovalDecisionInput.parse({ confirmed: true, decision: "approved", note: " 核对 ", runId: RUN.toUpperCase(), approvalId: APPROVAL.toUpperCase() })).toEqual({ confirmed: true, decision: "approved", note: " 核对 ", runId: RUN, approvalId: APPROVAL });
  });
  it.each([{}, { decision: "approved" }, { confirmed: false, decision: "approved" }, { confirmed: true, decision: "approved", resumeOnly: true }, { confirmed: true, decision: "approved", runId: RUN }, { confirmed: true, decision: "approved", note: "中".repeat(501) }])("决定正文严格拒绝不明确或多余字段 %j", (body) => {
    expect(RunApprovalDecisionBody.safeParse(body).success).toBe(false);
  });
  it("有界列表游标保留微秒且时间和标识必须成对", () => {
    expect(RunApprovalListInput.parse({ before: "2000-01-01T00:00:00.123456Z", beforeId: APPROVAL.toUpperCase(), limit: "50" })).toMatchObject({ before: "2000-01-01T00:00:00.123456Z", beforeId: APPROVAL, limit: 50 });
    for (const input of [{ beforeId: APPROVAL }, { before: "2000-01-01T00:00:00Z" }, { limit: 0 }, { limit: 51 }, { workspaceId: RUN }]) expect(RunApprovalListInput.safeParse(input).success).toBe(false);
  });
  it("确认列表不混入其他任务记录", () => {
    expect(RunApprovalListResult.safeParse({ ok: true, runId: RUN, items: [{ id: APPROVAL, runId: APPROVAL, nodeTitle: "核对", titleTruncated: false, status: "pending", runStatus: "waiting_approval", state: "pending", decisionConsumed: false, createdAt: "2000-01-01T00:00:00Z", decidedAt: null }], nextCursor: null }).success).toBe(false);
  });
});
