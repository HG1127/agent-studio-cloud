import { RunReportFile } from "@/contracts/run";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export function runReportFilename(
  run: Pick<RunReportFile["run"], "agentName" | "finishedAt" | "startedAt">,
  exportedAt: RunReportFile["exportedAt"],
): string {
  let date = RunReportFile.shape.exportedAt.parse(exportedAt).slice(0, 10);
  for (const timestamp of [run.finishedAt, run.startedAt]) {
    const parsed = RunReportFile.shape.exportedAt.safeParse(timestamp);
    if (parsed.success) { date = parsed.data.slice(0, 10); break; }
  }
  const safeName = redactSensitiveText(run.agentName).replace(/[^\p{L}\p{N}._-]+/gu, "-");
  // 按码点截断，避免把合法扩展汉字切成 encodeURIComponent 无法处理的半个字符。
  const name = Array.from(safeName).slice(0, 50).join("") || "run";
  return `${name}-${date}-运行报告.json`;
}
