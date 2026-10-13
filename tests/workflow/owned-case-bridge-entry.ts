import { it } from "vitest";
import { runOwnedWorkflowBridgeEntry } from "../helpers/run-owned-workflow-bridge-entry";

it("按父冻结上下文处理专用观察请求", async () => {
  const file = process.env.MVP_WORKFLOW_ACCEPTANCE_BRIDGE_REQUEST_FILE;
  if (!file) throw new Error("缺少父控制器自有桥接请求");
  await runOwnedWorkflowBridgeEntry(file);
});
