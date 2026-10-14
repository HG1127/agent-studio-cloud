import Link from "next/link";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { withSafeQueryError } from "@/server/security/query-error";
import { WebToolSavedRun } from "./WebToolSavedRun";
import { WebToolNavigation, webToolHref } from "./web-tool-navigation";

export async function WebToolTrialResult({ navigation }: { navigation: WebToolNavigation }) {
  const parsed = WebToolNavigation.safeParse(navigation);
  if (!parsed.success || !parsed.data.versionId || !parsed.data.runId) return <section id="web-tool-run-result" aria-labelledby="web-tool-run-result-title" className="content-card min-w-0 border-dashed"><h2 id="web-tool-run-result-title" className="section-title">内部运行结果</h2><p className="mt-2 text-sm leading-6 text-slate-600">确认试运行后可打开任务处理待办，再返回此页核对已保存的交付内容。当前没有关联任务；下方布局预览只有字段占位，不是执行结果。</p></section>;
  const versionId = parsed.data.versionId.toLowerCase();
  const runId = parsed.data.runId.toLowerCase();
  const reading = await (async () => {
    const run = await withSafeQueryError(async () => {
      const { getRunView } = await import("@/server/queries/runs");
      return getRunView(runId, DEMO_WORKSPACE_ID);
    }, "web-tool-trial-run");
    const source = run?.sourceType === "manual" ? await withSafeQueryError(async () => {
      const { getVersionExportSource } = await import("@/server/queries/versions");
      return getVersionExportSource(run.agentId, versionId, DEMO_WORKSPACE_ID);
    }, "web-tool-trial-source") : null;
    return { run, source };
  })().catch(() => null);
  if (reading === null) return <SectionReadState id="web-tool-run-result" title="内部运行结果暂时无法读取" description="尚未读全任务及其版本归属，没有将读取失败当成没有结果或运行失败。保留原关联，可重新读取；下方正式版本核对仍可独立使用。" />;
  const { run, source } = reading;
  if (!run || !source) return <section id="web-tool-run-result" aria-labelledby="web-tool-run-result-title" className="content-card border-amber-200"><h2 id="web-tool-run-result-title" className="section-title">无法核对本次运行关联</h2><p role="alert" className="mt-2 text-sm leading-6 text-amber-950">需要当前工作区的内部手动任务，且核对版本必须属于同一位助手。未展示未经核对的输入或结果，也没有自动切换到其他任务。</p><Link href={webToolHref({ versionId })} prefetch={false} className="mt-3 inline-block text-sm font-semibold text-indigo-700">移除运行关联，保留版本选择</Link></section>;
  const steps = await withSafeQueryError(async () => {
    const { listRunSteps } = await import("@/server/queries/runs");
    return listRunSteps(run.id, DEMO_WORKSPACE_ID);
  }, "web-tool-trial-steps").catch(() => null);
  return <WebToolSavedRun run={run} selectedVersionId={versionId} selectedVersion={source.version} sourceStatus={source.status} steps={steps ?? []} stepsUnavailable={steps === null} />;
}
