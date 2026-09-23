// 并发测试专用编排：8 个 appendTrace 作为并行 step 竞态抢 seq。
// getWritable 要求 workflow/step 上下文，step 直调会抛错，故不能在测试进程里直调 appendTrace。
import { appendTrace } from "@/server/steps/trace-step";

export async function concurrentTraceWorkflow(runId: string): Promise<void> {
  "use workflow";
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      appendTrace({ runId, kind: "test.concurrent", title: `并发轨迹 ${i}` }),
    ),
  );
}
