import { createHook, FatalError } from "workflow";
import type { DefaultResultDeliveryWake } from "@/contracts/default-result-delivery";
import { deliverDefaultResultStep, prepareDefaultResultDeliveryWaitStep, readDefaultResultDeliveryStateStep } from "@/server/steps/default-result-delivery-step";

export async function awaitDefaultResultDelivery(runId: string): Promise<void> {
  let state = await deliverDefaultResultStep(runId);
  while (state.status !== "confirmed" && state.status !== "failed") {
    state = await prepareDefaultResultDeliveryWaitStep(runId);
    if (state.status === "confirmed" || state.status === "failed") break;
    const hook = createHook<DefaultResultDeliveryWake>({ token: state.hookToken });
    try {
      if (await hook.getConflict()) throw new FatalError("成果核对消息入口发生冲突，流程不能继续");
      // Register first, then read once: a result committed before the hook existed cannot be lost.
      state = await readDefaultResultDeliveryStateStep(runId);
      if (state.status === "confirmed" || state.status === "failed") break;
      await hook;
      state = await deliverDefaultResultStep(runId);
    } finally {
      hook.dispose();
    }
  }
  if (state.status === "failed") throw new FatalError("成果流未通过完整核对；已保存业务成果不受影响");
}
