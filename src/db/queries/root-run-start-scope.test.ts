import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { rootRunStartScope } from "./root-run-start-scope";

describe("根运行启动范围", () => {
  it("仅接管无父任务且执行链归属为空或自身的已知根来源", () => {
    const query = new PgDialect().sqlToQuery(rootRunStartScope);
    expect(query.sql.replace(/\s+/g, " ").trim()).toBe(
      '( "runs"."source_type" in (\'manual\', \'schedule\', \'evaluation\')'
      + ' and "runs"."parent_run_id" is null'
      + ' and ("runs"."execution_root_run_id" is null or "runs"."execution_root_run_id" = "runs"."id") )',
    );
    expect(query.params).toEqual([]);
  });
});
