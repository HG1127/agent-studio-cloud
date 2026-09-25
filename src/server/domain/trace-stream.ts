import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function writeTraceStreamBestEffort(
  write: () => Promise<void>,
  onError: (error: unknown) => void = (error) => console.error("[trace] 写入观测流失败", safeErrorForLog(error)),
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
