import { getWorkflowMetadata } from "workflow";
import { getRun } from "workflow/api";

export async function writeTraceStreamWithOwnOperations(payload: string): Promise<void> {
  const ops: Promise<unknown>[] = [];
  let writer: WritableStreamDefaultWriter<string> | undefined;
  let failure: unknown;
  let failed = false;
  try {
    writer = getRun(getWorkflowMetadata().workflowRunId).getWritable<string>({ namespace: "trace", ops }).getWriter();
    await writer.write(payload);
  }
  catch (error) { failed = true; failure = error; }
  finally {
    try { writer?.releaseLock(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    let offset = 0;
    while (offset < ops.length) {
      const batch = ops.slice(offset);
      offset += batch.length;
      for (const result of await Promise.allSettled(batch)) {
        if (result.status === "rejected" && !failed) { failed = true; failure = result.reason; }
      }
    }
  }
  if (failed) throw failure;
}
