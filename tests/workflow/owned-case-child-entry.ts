import { writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "vitest";
import { WorkflowAcceptanceChildReport, WorkflowAcceptanceContext, type WorkflowAcceptanceRealmReceipt } from "@/contracts/workflow-case-acceptance";
import { closeAcceptanceRealmPools } from "@/db/runtime/acceptance-client-lifecycle";

it("执行父控制器指定的真实业务案例并保留子域回执", async () => {
  const context = WorkflowAcceptanceContext.parse(JSON.parse(process.env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT ?? "null"));
  const output = process.env.MVP_WORKFLOW_ACCEPTANCE_CHILD_REPORT;
  if (!output || !path.isAbsolute(output) || path.basename(output) !== "child-result.json"
    || process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1") throw new Error("子执行域配置无效");
  let businessError: unknown;
  let businessFailed = false;
  let closeFailed = false;
  const realms: WorkflowAcceptanceRealmReceipt[] = [];
  try {
    const { executeOwnedWorkflowCase } = await import("./owned-case-business");
    await executeOwnedWorkflowCase(context);
  } catch (error) { businessFailed = true; businessError = error; }
  try { realms.push(await closeAcceptanceRealmPools()); }
  catch { closeFailed = true; }
  const report = WorkflowAcceptanceChildReport.parse({ version: 1, context,
    businessStatus: businessFailed || closeFailed ? "failed" : "passed", realms,
    failureCode: businessFailed ? "business" : closeFailed ? "pool-close" : null, cleanupPermitted: false });
  await writeFile(output, JSON.stringify(report), { encoding: "utf8", flag: "wx" });
  if (businessFailed) throw businessError;
  if (closeFailed) throw new Error("本执行空间数据库池关闭未确认");
});
