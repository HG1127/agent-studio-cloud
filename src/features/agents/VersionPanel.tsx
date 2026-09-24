"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { VersionSummary } from "@/contracts/version";
import type { ModelConnectionView } from "@/contracts/connections";
import { publishVersionAction } from "@/server/actions/publish-version";
import { restoreVersionAction } from "@/server/actions/restore-version";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function VersionPanel({ agentId, versions, connections, defaultModelLabel }: {
  agentId: string;
  versions: VersionSummary[];
  connections: ModelConnectionView[];
  defaultModelLabel: string;
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
  const currentVersion = displayedVersions.find((version) => version.status === "production");

  async function handlePublish() {
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

  async function handleRestore(versionId: string) {
    setRestoringId(versionId);
    setFailure(null);
    setDemoNotice(null);
    setReleaseNotice(null);
    try {
      const result = await restoreVersionAction(agentId, versionId);
      if (result.ok) {
        setOptimisticVersions((current) => [...current, result.version]);
        router.refresh();
      } else setFailure({ error: result.error, issues: [] });
    } catch {
      setFailure({ error: "恢复失败，请稍后重试", issues: [] });
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">版本历史</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            运行模型
            <select value={modelSelection} onChange={(event) => setModelSelection(event.target.value)} disabled={pending}
              className="max-w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">{defaultModelLabel}</option>
              {modelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={handlePublish}
            disabled={pending || hasUnsavedDraft}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
          >
            {pending ? "正在发布…" : hasUnsavedDraft ? "请先保存草稿" : "发布新版本"}
          </button>
        </div>
      </div>
      {hasUnsavedDraft ? <p role="status" className="text-sm text-amber-700">流程有未保存修改，保存后才能发布。</p> : null}
      {failure ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
        <p role="status" className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{releaseNotice}</p>
      ) : null}
      {demoNotice ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          <p>已发布。演示期提醒：还有 {demoNotice.length} 个设计检查问题待处理</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {demoNotice.map((title, index) => (
              <li key={index}>{title}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {displayedVersions.length > 0 ? (
        <ul className="flex flex-col divide-y divide-gray-100">
          {displayedVersions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">版本 {version.version}</span>
              <span
                className={
                  version.status === "production"
                    ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                }
              >
                {version.status === "production"
                  ? "当前版本"
                  : version.status === "candidate"
                    ? "待验收"
                    : version.status === "superseded"
                      ? "未上线"
                      : "历史版本"}
              </span>
              <span className="text-gray-500">{formatTime(version.createdAt)}</span>
              <a href={`/api/agents/${agentId}/versions/${version.id}/export`} download
                className="text-xs text-blue-700 hover:underline">下载此版本</a>
              {currentVersion && currentVersion.id !== version.id ? (
                <a href={`/agents/${agentId}/versions/compare?from=${version.id}&to=${currentVersion.id}`}
                  className="text-xs text-blue-700 hover:underline">与当前版本对比</a>
              ) : null}
              {version.status === "retired" ? (
                <button
                  type="button"
                  disabled={pending || restoringId !== null || hasUnsavedDraft}
                  onClick={() => handleRestore(version.id)}
                  className="ml-auto rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-500 disabled:text-gray-400"
                >
                  {restoringId === version.id ? "正在恢复…" : "恢复为当前版本"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">还没有发布过版本，完善流程后点「发布新版本」。</p>
      )}
    </section>
  );
}
