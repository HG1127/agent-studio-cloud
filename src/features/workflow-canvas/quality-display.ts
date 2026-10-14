import { isPassiveJsonData } from "@/contracts/json";
import { MAX_WORKFLOW_BYTES } from "@/contracts/workflow";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export function qualityDisplay(canvasDraft: unknown, ownerId?: string) {
  const identifiers = new Set<string>(ownerId ? [ownerId] : []);
  function collect(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const item = value as Record<string, unknown>;
    for (const key of ["id", "versionId"]) if (typeof item[key] === "string" && item[key]) identifiers.add(item[key]);
  }
  if (isPassiveJsonData(canvasDraft, MAX_WORKFLOW_BYTES) && canvasDraft && typeof canvasDraft === "object" && !Array.isArray(canvasDraft)) {
    const root = canvasDraft as Record<string, unknown>;
    collect(root); collect(root.rootAgent);
    if (root.nodes && typeof root.nodes === "object" && !Array.isArray(root.nodes)) {
      for (const [id, node] of Object.entries(root.nodes)) { if (id) identifiers.add(id); collect(node); }
    }
  }
  const patterns = [...identifiers].sort((left, right) => right.length - left.length).map((id) => {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?=$|[^A-Za-z0-9_-])`, "g");
  });
  return (text: string) => patterns.reduce((value, pattern) => value.replace(pattern, "$1[内部标识已隐藏]"), redactSensitiveText(text));
}
