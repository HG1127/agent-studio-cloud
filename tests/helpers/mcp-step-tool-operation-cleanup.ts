import { stopRegisteredNameTestRuns } from "./mcp-registered-tool-name-cleanup";

export async function cleanupMcpStepToolRun(args: {
  handles: Parameters<typeof stopRegisteredNameTestRuns>[0];
  pendingStartRunIds: readonly string[];
  deleteOwnedRecords: () => Promise<void>;
  closeService: () => Promise<void>;
  restoreEnvironment: () => void;
}): Promise<void> {
  const errors: unknown[] = [];
  try {
    await stopRegisteredNameTestRuns(args.handles, args.pendingStartRunIds);
    await args.deleteOwnedRecords();
  } catch (error) { errors.push(error); }
  finally {
    try { await args.closeService(); } catch (error) { errors.push(error); }
    try { args.restoreEnvironment(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "MCP写步骤验收清理失败，未确认停止时保留数据库记录");
}
