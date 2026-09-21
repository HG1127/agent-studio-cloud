"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VersionSummary } from "@/contracts/version";
import { publishVersionAction } from "@/server/actions/publish-version";

function formatTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function VersionPanel({ agentId, versions }: { agentId: string; versions: VersionSummary[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ error: string; issues: string[] } | null>(null);

  async function handlePublish() {
    setPending(true);
    setFailure(null);
    const result = await publishVersionAction(agentId);
    if (result.ok) {
      router.refresh();
    } else {
      setFailure({ error: result.error, issues: result.issues });
    }
    setPending(false);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">版本历史</h2>
        <button
          type="button"
          onClick={handlePublish}
          disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400"
        >
          {pending ? "正在发布…" : "发布新版本"}
        </button>
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
