import { sql } from "drizzle-orm";
import { runs } from "@/db/schema/runs";

// 内联协作复用父引擎；旧根记录尚未保存执行链归属时仍可恢复。
export const rootRunStartScope = sql<boolean>`(
  ${runs.sourceType} in ('manual', 'schedule', 'evaluation')
  and ${runs.parentRunId} is null
  and (${runs.executionRootRunId} is null or ${runs.executionRootRunId} = ${runs.id})
)`;
