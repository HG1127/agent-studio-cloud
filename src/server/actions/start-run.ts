"use server";
import { RunStartInput, type StartRunResult } from "@/contracts/run";
import { validationMessage } from "@/server/domain/validation-message";
import { startRunCore } from "@/server/services/start-run-core";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

export async function startRunAction(input: RunStartInput): Promise<StartRunResult> {
  const parsedInput = RunStartInput.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: validationMessage(parsedInput.error, "启动参数不正确，请刷新页面后重试") };
  }
  const result = await startRunCore({
    agentId: parsedInput.data.agentId,
    input: parsedInput.data.input,
    sourceType: "manual",
    sourceKey: parsedInput.data.requestId ? `manual:${parsedInput.data.requestId}` : null,
  });
  if (result.ok) {
    revalidatePathsAfterCommit([`/agents/${parsedInput.data.agentId}`, "/agents"], "run-start");
  }
  return result;
}
