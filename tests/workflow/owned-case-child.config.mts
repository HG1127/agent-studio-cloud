import path from "node:path";
import { defineConfig } from "vitest/config";
import { workflow } from "@workflow/vitest";
import { createOwnedWorkflowPool } from "../helpers/owned-workflow-pool";
import { WorkflowAcceptanceContext } from "../../src/contracts/workflow-case-acceptance";

const context = WorkflowAcceptanceContext.parse(JSON.parse(process.env.MVP_WORKFLOW_ACCEPTANCE_CONTEXT ?? "null"));
if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1" || process.env.MODEL_MOCK !== "1") throw new Error("子执行域隔离条件未确认");
const cwd = path.resolve(import.meta.dirname, "../..");
export default defineConfig({
  plugins: [workflow({ cwd, rootDir: context.sdkDirectory, dataDir: path.join(context.sdkDirectory, "data"), outDir: path.join(context.sdkDirectory, "bundles") })],
  resolve: { alias: { "@": path.join(cwd, "src") } },
  test: { name: "owned-workflow-case", environment: "node", pool: createOwnedWorkflowPool(), maxWorkers: 1,
    include: ["tests/workflow/owned-case-child-entry.ts"], fileParallelism: false,
    testTimeout: 240_000, hookTimeout: 240_000, env: { WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY: "5" } },
});
