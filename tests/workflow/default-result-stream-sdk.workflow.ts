import { createHook, FatalError } from "workflow";
import {
  closeDefaultResultStream, DefaultResultStreamSdkError, writeDefaultResultStreamFrame,
  type DefaultResultStreamSdkMutationInput,
} from "@/server/services/default-result-stream-sdk";

export async function defaultResultStreamHolderWorkflow(token: string) {
  "use workflow";
  const hook = createHook<boolean>({ token });
  try {
    if (await hook.getConflict()) throw new FatalError("成果流测试接收入口发生冲突");
    await hook;
    return { status: "completed" };
  } finally {
    hook.dispose();
  }
}

async function executeDefaultResultStreamSdk(input: DefaultResultStreamSdkMutationInput, operation: "write" | "close") {
  "use step";
  try {
    const observation = operation === "write"
      ? await writeDefaultResultStreamFrame(input)
      : await closeDefaultResultStream(input);
    return { ok: true as const, observation };
  } catch (error) {
    if (!(error instanceof DefaultResultStreamSdkError)) throw error;
    return { ok: false as const, code: error.code, acknowledgement: error.acknowledgement };
  }
}

export async function defaultResultStreamSdkOperationWorkflow(input: DefaultResultStreamSdkMutationInput, operation: "write" | "close") {
  "use workflow";
  return executeDefaultResultStreamSdk(input, operation);
}
