import { HarnessNavigation, type RunContextFilters } from "./harness-filter-state";
import { harnessConsoleHref } from "./harness-navigation";
export { CONTEXT_PAGE_SIZE, RunContextFilters } from "./harness-filter-state";

export function runContextHref(runId: string, filters: RunContextFilters, navigation = HarnessNavigation.parse({})): string {
  return harnessConsoleHref({ ...navigation, runId, context: filters }, "saved-context");
}

export function contextStepAnchor(stepId: string): string {
  return "harness-step-" + stepId;
}
