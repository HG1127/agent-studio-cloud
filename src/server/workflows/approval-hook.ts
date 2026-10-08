import { createHook, FatalError } from "workflow";
import { readRecordedApprovalDecision, type ApprovalHandle } from "@/server/steps/approval-step";

type RecordedDecision = NonNullable<ApprovalHandle["recordedDecision"]>;

export async function awaitApprovalDecision(runId: string, handle: ApprovalHandle): Promise<RecordedDecision> {
  if (handle.recordedDecision) return handle.recordedDecision;
  const hook = createHook<RecordedDecision>({ token: handle.token });
  try {
    if (await hook.getConflict()) throw new FatalError("确认消息接收入口发生冲突，请重新运行");
    // 入口注册之前的确认已落库但无法投递；注册之后读一次即可覆盖早到和晚到两种时序。
    return await readRecordedApprovalDecision({ runId, approvalId: handle.approvalId }) ?? await hook;
  } finally {
    hook.dispose();
  }
}
