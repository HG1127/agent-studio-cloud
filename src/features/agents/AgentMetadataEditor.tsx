"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateAgentAction } from "@/server/actions/update-agent";

export function AgentMetadataEditor({ agentId, initialName, initialDescription }: {
  agentId: string;
  initialName: string;
  initialDescription: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editing) {
    return <button type="button" onClick={() => setEditing(true)} className="w-fit text-sm text-gray-500 hover:text-gray-800">编辑名称和说明</button>;
  }
  return <form className="flex max-w-xl flex-col gap-2 rounded-md border border-gray-200 bg-white p-3" onSubmit={async (event) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await updateAgentAction({ agentId, name, description: description.trim() || null });
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else setError(result.error);
    } catch {
      setError("更新助手信息失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }}>
    <label className="flex flex-col gap-1 text-sm">助手名称
      <input aria-label="编辑助手名称" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)}
        className="rounded-md border border-gray-300 px-3 py-2" />
    </label>
    <label className="flex flex-col gap-1 text-sm">助手说明
      <textarea aria-label="编辑助手说明" maxLength={200} rows={2} value={description} onChange={(event) => setDescription(event.target.value)}
        className="rounded-md border border-gray-300 px-3 py-2" />
    </label>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    <div className="flex gap-2">
      <button type="submit" disabled={pending} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{pending ? "保存中…" : "保存信息"}</button>
      <button type="button" disabled={pending} onClick={() => { setEditing(false); setName(initialName); setDescription(initialDescription ?? ""); setError(null); }}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm">取消</button>
    </div>
  </form>;
}
