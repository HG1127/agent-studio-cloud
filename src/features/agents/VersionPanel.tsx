"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, GitCompareArrows, History, RotateCcw, Rocket, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { VersionSummary } from "@/contracts/version";
import type { ModelConnectionView } from "@/contracts/connections";
import { publishVersionAction } from "@/server/actions/publish-version";
import { restoreVersionAction } from "@/server/actions/restore-version";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";
import { readSessionValue, removeSessionValue, writeSessionValue } from "@/lib/session-storage";

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function VersionPanel({
  agentId,
  versions,
  connections,
  defaultModelLabel,
  currentVersionId = null,
  versionPage = 1,
  hasMoreVersions = false,
  archivedCasesPage = 1,
  evaluationRunsPage = 1,
}: {
  agentId: string;
  versions: VersionSummary[];
  connections: ModelConnectionView[];
  defaultModelLabel: string;
  currentVersionId?: string | null;
  versionPage?: number;
  hasMoreVersions?: boolean;
  archivedCasesPage?: number;
  evaluationRunsPage?: number;
}) {
  const router = useRouter();
  const [optimisticVersions, setOptimisticVersions] = useState<VersionSummary[]>([]);
  const [modelSelection, setModelSelection] = useState("");
  const modelOptions = connections.flatMap((connection) => connection.modelIds.map((modelId) => ({
    value: JSON.stringify([connection.id, modelId]),
    label: `${connection.name} / ${modelId}`,
    selection: { connectionId: connection.id, modelId },
  })));
  const [pending, setPending] = useState(false);
  const [hasUnsavedDraft, setHasUnsavedDraft] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null);
  const restoreInFlight = useRef(false);
  const [uncertainRestore, setUncertainRestore] = useState<VersionSummary | null>(null);
  const [restoreStorageUnavailable, setRestoreStorageUnavailable] = useState(false);
  const [unlockRestoreOpen, setUnlockRestoreOpen] = useState(false);
  const restoreRecoveryKey = `agent-studio:version-restore:${agentId}`;
  const [failure, setFailure] = useState<{ error: string; issues: string[] } | null>(null);
  const [demoNotice, setDemoNotice] = useState<string[] | null>(null);
  const [releaseNotice, setReleaseNotice] = useState<string | null>(null);

  useEffect(() => {
    const receiveDraftState = (event: Event) => {
      const detail = (event as CustomEvent<DraftStateDetail>).detail;
      if (detail?.agentId === agentId) setHasUnsavedDraft(detail.dirty);
    };
    window.addEventListener(DRAFT_STATE_EVENT, receiveDraftState);
    return () => window.removeEventListener(DRAFT_STATE_EVENT, receiveDraftState);
  }, [agentId]);

  useEffect(() => {
    const raw = readSessionValue(restoreRecoveryKey);
    if (!raw) return;
    try {
      const parsed = VersionSummary.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.status !== "retired") throw new Error("invalid restore state");
      queueMicrotask(() => setUncertainRestore(parsed.data));
    } catch {
      removeSessionValue(restoreRecoveryKey);
    }
  }, [restoreRecoveryKey]);

  const displayedVersions = optimisticVersions.reduce<VersionSummary[]>((current, published) => [
    published,
    ...current
      .filter((version) => version.id !== published.id)
      .map((version) => ({
        ...version,
        status: version.status === "candidate"
          ? "superseded"
          : published.status === "production" && version.status === "production"
            ? "retired"
            : version.status,
      })),
  ], versions);
  const effectiveCurrentVersionId = displayedVersions.find((version) => version.status === "production")?.id ?? currentVersionId;
  const versionPageHref = (page: number) => {
    const params = new URLSearchParams({ versionsPage: String(page) });
    if (archivedCasesPage > 1) params.set("archivedCasesPage", String(archivedCasesPage));
    if (evaluationRunsPage > 1) params.set("evaluationRunsPage", String(evaluationRunsPage));
    return `?${params.toString()}#versions`;
  };

  async function handlePublish() {
    if (restoreInFlight.current) {
      setFailure({ error: "请等待版本恢复完成，再发布新版本", issues: [] });
      return;
    }
    if (uncertainRestore) {
      setFailure({ error: "请先核对上次版本恢复结果，再发布新版本", issues: [] });
      return;
    }
    if (hasUnsavedDraft) {
      setFailure({ error: "请先保存流程草稿，再发布新版本", issues: [] });
      return;
    }
    setPending(true);
    setFailure(null);
    setDemoNotice(null);
    setReleaseNotice(null);
    const selection = modelOptions.find((option) => option.value === modelSelection)?.selection;
    if (modelSelection && !selection) {
      setFailure({ error: "所选模型已不可用，请重新选择后再发布", issues: [] });
      setPending(false);
      return;
    }
    try {
      const result = await publishVersionAction(agentId, selection);
      if (result.ok) {
        if (result.version) {
          setOptimisticVersions((current) => [...current, result.version]);
        }
        const exempted = result.exempted ?? [];
        if (exempted.length > 0) setDemoNotice(exempted.map((issue) => issue.title));
        if (result.release === "candidate") {
          setReleaseNotice("待验收版本已创建。请在下方运行全部验收样例，通过后会自动上线。");
        }
        router.refresh();
      } else {
        setFailure({ error: result.error, issues: result.issues });
      }
    } catch {
      setFailure({ error: "发布失败，请稍后重试", issues: [] });
    } finally {
      setPending(false);
    }
  }

  async function handleRestore(version: VersionSummary) {
    if (restoreInFlight.current) return;
    setRestoreTarget(null);
    if (uncertainRestore) {
      setFailure({ error: "请先核对上次版本恢复结果，再次操作可能覆盖新的正式版本", issues: [] });
      return;
    }
    if (pending || hasUnsavedDraft) {
      setFailure({ error: "请先保存流程草稿，并等待当前操作完成后再恢复版本", issues: [] });
      return;
    }
    restoreInFlight.current = true;
    setRestoringId(version.id);
    setFailure(null);
    setDemoNotice(null);
    setReleaseNotice(null);
    try {
      const result = await restoreVersionAction(agentId, version.id);
      if (result.ok) {
        removeSessionValue(restoreRecoveryKey);
        setOptimisticVersions((current) => [...current, result.version]);
        setReleaseNotice(`已从历史版本 ${version.version} 恢复，生成新的正式版本 ${result.version.version}。后续新任务会使用新版本。`);
        router.refresh();
      } else {
        removeSessionValue(restoreRecoveryKey);
        setFailure({ error: result.error, issues: [] });
      }
    } catch {
      setUncertainRestore(version);
      setRestoreStorageUnavailable(!writeSessionValue(restoreRecoveryKey, JSON.stringify(version)));
      router.refresh();
    } finally {
      restoreInFlight.current = false;
      setRestoringId(null);
    }
  }

  const productionVersion = displayedVersions.find((version) => version.status === "production");
  const candidateVersion = displayedVersions.find((version) => version.status === "candidate");
  const recoverableCount = displayedVersions.filter((version) => version.status === "retired").length;

  function versionBadge(status: string) {
    if (status === "production") return <Badge tone="success">当前版本</Badge>;
    if (status === "candidate") return <Badge tone="warning">待验收</Badge>;
    if (status === "superseded") return <Badge>未上线</Badge>;
    if (status === "retired") return <Badge>历史版本</Badge>;
    return <Badge>{status}</Badge>;
  }

  return (
    <section id="versions" className="scroll-mt-32 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <header className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Rocket className="size-5" /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-indigo-600">发布准备</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">版本发布</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">把已保存的流程冻结为不可变版本；有验收样例时先生成候选版本，通过后自动上线。</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            运行模型
            <select value={modelSelection} onChange={(event) => setModelSelection(event.target.value)} disabled={pending}
              className="h-10 max-w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100">
              <option value="">{defaultModelLabel}</option>
              {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <Button type="button" size="lg" onClick={handlePublish} disabled={pending || restoringId !== null || hasUnsavedDraft || uncertainRestore !== null}>
            <Rocket className="size-4" />{pending ? "正在发布…" : restoringId ? "正在恢复版本…" : uncertainRestore ? "请先核对恢复状态" : hasUnsavedDraft ? "请先保存草稿" : "发布新版本"}
          </Button>
        </div>
      </header>

      <div className="grid gap-3 border-y border-slate-100 bg-slate-50/70 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${candidateVersion ? "bg-amber-50 text-amber-600" : productionVersion ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
            {candidateVersion ? <ShieldCheck className="size-[18px]" /> : productionVersion ? <Rocket className="size-[18px]" /> : <History className="size-[18px]" />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">
              {candidateVersion ? `候选版本 ${candidateVersion.version} 等待自动验收` : productionVersion ? `正式版本 ${productionVersion.version} 正在运行` : effectiveCurrentVersionId ? "正式版本未列在本页" : "还没有可运行版本"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {candidateVersion ? "运行下方全部验收样例；全部通过后系统会自动将候选版本设为正式版本。" : productionVersion ? "当前版本已经冻结，后续发布不会悄悄改动这个运行快照。" : effectiveCurrentVersionId ? "当前页只展示较早的版本；请回到版本历史第一页核对正式版本。" : "先完成流程设计与检查，再发布首个版本。"}
            </p>
          </div>
        </div>
        {candidateVersion ? <Link href="#evaluation" className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-200 bg-white px-3 text-sm font-semibold text-amber-800 shadow-sm hover:bg-amber-50">前往自动验收</Link> : (
          <div className="flex gap-2 text-xs text-slate-500">
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-2">已记录 {displayedVersions.length} 个版本</span>
            <span className="rounded-lg border border-slate-200 bg-white px-3 py-2">可恢复 {recoverableCount} 个</span>
          </div>
        )}
      </div>

      <div className="space-y-3 px-5 pt-5">
      {hasUnsavedDraft ? <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">流程有未保存修改，保存后才能发布或恢复版本。</p> : null}
      {uncertainRestore ? <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        <p className="font-semibold">版本 {uncertainRestore.version} 的恢复结果尚未确认</p>
        <p className="mt-1">请求可能已生效。请核对最新版本和操作记录，确认前不要再次恢复或发布。</p>
        {restoreStorageUnavailable ? <p className="mt-1">浏览器未能保留核对线索；请保持此页面打开，先完成核对。</p> : null}
        <div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">重新读取版本状态</button><Link href="/activity?type=version" className="font-semibold underline underline-offset-2">查看版本操作记录</Link><button type="button" onClick={() => setUnlockRestoreOpen(true)} className="font-semibold underline underline-offset-2">已核对，继续操作</button></div>
      </div> : null}
      {failure ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{failure.error}</p>
          {failure.issues.length > 0 ? (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {failure.issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {releaseNotice ? (
        <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{releaseNotice}</p>
      ) : null}
      {demoNotice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <p>已发布。还有 {demoNotice.length} 个控制面检查提醒</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {demoNotice.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}
      </div>

      <div className="p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-slate-900">版本历史</h3><p className="mt-1 text-xs text-slate-500">每个版本都可下载；历史版本可恢复为新的正式版本。</p></div>
          <span className="text-xs text-slate-400">本页 {displayedVersions.length} 条</span>
        </div>
      {displayedVersions.length > 0 ? (
        <ul className="grid gap-2">
          {displayedVersions.map((version) => (
            <li key={version.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
              <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${version.status === "production" ? "bg-emerald-50 text-emerald-600" : version.status === "candidate" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                {version.status === "production" ? <Rocket className="size-4" /> : version.status === "candidate" ? <ShieldCheck className="size-4" /> : <History className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-slate-900">版本 {version.version}</span>{versionBadge(version.status)}</div>
                <time dateTime={version.createdAt} className="mt-1 block text-xs text-slate-500">创建于 {formatTime(version.createdAt)}</time>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <a href={`/api/agents/${agentId}/versions/${version.id}/export`} download className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"><Download className="size-3.5" />下载此版本</a>
                {effectiveCurrentVersionId && effectiveCurrentVersionId !== version.id ? (
                  <a href={`/agents/${agentId}/versions/compare?from=${version.id}&to=${effectiveCurrentVersionId}`} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"><GitCompareArrows className="size-3.5" />与当前版本对比</a>
                ) : null}
                {version.status === "retired" ? (
                  <Button type="button" variant="secondary" size="sm" disabled={pending || restoringId !== null || hasUnsavedDraft || uncertainRestore !== null} onClick={() => setRestoreTarget(version)}>
                    <RotateCcw className="size-3.5" />{restoringId === version.id ? "正在恢复…" : "恢复为当前版本"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-5 py-8 text-center"><p className="text-sm font-medium text-slate-700">还没有发布过版本</p><p className="mt-1 text-xs leading-5 text-slate-500">完善并保存流程后，点击上方“发布新版本”。</p></div>
      )}
      {versionPage > 1 || hasMoreVersions ? (
        <nav aria-label="版本翻页" className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
          {versionPage > 1 ? <Link href={versionPageHref(versionPage - 1)} className="font-medium text-indigo-600 hover:text-indigo-800">上一页</Link> : <span />}
          <span className="text-xs text-gray-500">第 {versionPage} 页</span>
          {hasMoreVersions ? <Link href={versionPageHref(versionPage + 1)} className="font-medium text-indigo-600 hover:text-indigo-800">下一页</Link> : <span />}
        </nav>
      ) : null}
      </div>
      <ConfirmDialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}
        title={`恢复历史版本 ${restoreTarget?.version ?? ""}？`}
        description={`${productionVersion ? `当前正式版本 ${productionVersion.version}` : effectiveCurrentVersionId ? "当前正式版本未列在本页" : "当前没有正式版本"}；将从历史版本 ${restoreTarget?.version ?? ""} 生成新的正式版本。后续新任务会使用新版本，已有运行保留原版本；待验收的候选版本会停止自动上线。提交时还会核对资料、工具和发布条件。`}
        confirmLabel="确认恢复" tone="warning" onConfirm={() => { if (restoreTarget) void handleRestore(restoreTarget); }} />
      <ConfirmDialog open={unlockRestoreOpen} onOpenChange={setUnlockRestoreOpen}
        title="已核对上次版本恢复？"
        description="上次恢复可能已经生效。请先确认当前正式版本和操作记录；继续后再次恢复或发布可能替换其他人刚更新的版本。"
        confirmLabel="继续操作" tone="warning" onConfirm={() => {
          removeSessionValue(restoreRecoveryKey);
          setUncertainRestore(null);
          setRestoreStorageUnavailable(false);
          setUnlockRestoreOpen(false);
        }} />
    </section>
  );
}
