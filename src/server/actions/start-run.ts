"use server";
import { revalidatePath } from "next/cache";
import { RunStartInput, type StartRunResult } from "@/contracts/run";
import { startRunCore } from "@/server/services/start-run-core";

export async function startRunAction(input: RunStartInput): Promise<StartRunResult> {
  const parsedInput = RunStartInput.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: "启动参数不正确，请刷新页面后重试" };
  }
  const result = await startRunCore({ agentId: parsedInput.data.agentId, input: parsedInput.data.input });
  if (result.ok) {
    revalidatePath(`/agents/${parsedInput.data.agentId}`);
    revalidatePath("/agents");
  }
  return result;
}
