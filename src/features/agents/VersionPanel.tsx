"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VersionSummary } from "@/contracts/version";
import type { ModelConnectionView } from "@/contracts/connections";
import { publishVersionAction } from "@/server/actions/publish-version";

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
  const [modelSelection, setModelSelection] = useState("");
  const modelOptions = connections.flatMap((connection) => connection.modelIds.map((modelId) => ({
    value: JSON.stringify([connection.id, modelId]),
    label: `${connection.name} / ${modelId}`,
    selection: { connectionId: connection.id, modelId },
  })));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: string; issues: string[] } | null>(null);
  const [demoNotice, setDemoNotice] = useState<string[] | null>(null);

  async function handlePublish() {
    setPending(true);
    setFailure(null);
    setDemoNotice(null);
    const selection = modelOptions.find((option) => option.value === modelSelection)?.selection;
    if (modelSelection && !selection) {
      setFailure({ error: "所选模型已不可用，请重新选择后再发布", issues: [] });
      setPending(false);
      return;
    }
    try {
      const result = await publishVersionAction(agentId, selection);
      if (result.ok) {
        const exempted = result.exempted ?? [];
        if (exempted.length > 0) setDemoNotice(exempted.map((issue) => issue.title));
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
            disabled={pending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
          >
            {pending ? "正在发布…" : "发布新版本"}
          </button>
        </div>
      </div>
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
      {versions.length > 0 ? (
        <ul className="flex flex-col divide-y divide-gray-100">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">版本 {version.version}</span>
              <span
                className={
                  version.status === "production"
                    ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
                    : "rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
                }
              >
                {version.status === "production" ? "当前版本" : "历史版本"}
              </span>
              <span className="text-gray-500">{formatTime(version.createdAt)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">还没有发布过版本，完善流程后点「发布新版本」。</p>
      )}
    </section>
  );
}
