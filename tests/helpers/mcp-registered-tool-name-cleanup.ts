import type { Run } from "workflow/api";

type OwnedRun = Pick<Run<unknown>, "status" | "cancel">;
const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export async function stopRegisteredNameTestRuns(handles: readonly OwnedRun[], pendingStartRunIds: readonly string[] = []): Promise<void> {
  const errors: unknown[] = [];
  for (const handle of handles) {
    try {
      let terminal = false;
      try { terminal = terminalStatuses.has(await handle.status); } catch { /* 状态读取失败时仍尝试取消自有句柄。 */ }
      if (terminal) continue;
      await handle.cancel();
      if (!terminalStatuses.has(await handle.status)) throw new Error("本套件工作流尚未确认停止");
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "本套件工作流清理失败，保留数据库记录");
  if (pendingStartRunIds.length) throw new Error("本套件启动尚未返回引擎句柄，保留数据库记录");
}
