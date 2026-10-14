import { z } from "zod";

export const TraceKindFilter = z.enum(["all", "policy", "context", "quality", "other"]);
export type TraceKindFilter = z.infer<typeof TraceKindFilter>;

export const TRACE_KIND_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "policy", label: "运行策略" },
  { value: "context", label: "上下文边界" },
  { value: "quality", label: "质量检查" },
  { value: "other", label: "其他与未知" },
] as const satisfies readonly { value: TraceKindFilter; label: string }[];

export function traceKindCategory(kind: string): Exclude<TraceKindFilter, "all"> {
  switch (kind) {
    case "harness.policy": return "policy";
    case "harness.context": return "context";
    case "quality.failed":
    case "quality.passed":
    case "quality.rework_requested": return "quality";
    default: return "other";
  }
}

export function traceKindLabel(kind: string): string {
  const labels = { policy: "运行策略", context: "上下文边界", quality: "质量检查", other: "其他与未知" };
  return labels[traceKindCategory(kind)];
}
