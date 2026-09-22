// failRun 写 run.failed 轨迹要走 getWritable（要求 workflow 上下文），测试进程直调会抛错，故经真实 workflow 包装
import { failRun } from "@/server/steps/run-state";

export async function failRunProbeWorkflow(runId: string, error: string) {
  "use workflow";
  await failRun(runId, error);
}
