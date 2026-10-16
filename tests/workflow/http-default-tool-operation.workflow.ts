import { runToolStep, type RunToolStepInput } from "@/server/steps/tool-step";

export async function httpDefaultToolOperationWorkflow(input: RunToolStepInput) {
  "use workflow";
  return runToolStep(input);
}
