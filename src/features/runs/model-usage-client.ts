import { AttentionIdentifier } from "@/contracts/attention-reference";
import { RunModelUsageResult, type RunModelUsage } from "@/contracts/model-usage";
import { RunModelUsageChainResult, type RunModelUsageChain } from "@/contracts/model-usage-chain";

async function readUsage(runId: string, chain: boolean, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await fetch("/api/runs/" + encodeURIComponent(runId) + "/usage" + (chain ? "/chain" : ""), {
      method: "GET", cache: "no-store", credentials: "same-origin", signal,
    });
    if (!response.ok) throw new Error("读取未成功");
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error("用量记录暂时无法读取");
  }
}

export async function readRunModelUsage(runId: string, signal: AbortSignal): Promise<RunModelUsage> {
  const id = AttentionIdentifier.safeParse(runId);
  if (!id.success) throw new Error("任务信息无法核对");
  const result = RunModelUsageResult.safeParse(await readUsage(id.data, false, signal));
  if (!result.success || !result.data.ok || result.data.summary.runId !== id.data) throw new Error("当前任务用量记录无法核对");
  return result.data.summary;
}

export async function readRunModelUsageChain(runId: string, signal: AbortSignal): Promise<RunModelUsageChain> {
  const id = AttentionIdentifier.safeParse(runId);
  if (!id.success) throw new Error("任务信息无法核对");
  const result = RunModelUsageChainResult.safeParse(await readUsage(id.data, true, signal));
  if (!result.success || !result.data.ok || result.data.summary.requestedRunId !== id.data) throw new Error("协作链用量记录无法核对");
  return result.data.summary;
}
