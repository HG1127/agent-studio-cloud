import { revalidatePath } from "next/cache";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export function revalidatePathsAfterCommit(paths: readonly string[], operation: string): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (error) {
      console.error(`[${operation}] 页面缓存刷新失败`, safeErrorForLog(error));
    }
  }
}
