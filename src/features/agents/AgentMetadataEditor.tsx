"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Save } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AgentUpdateInput, type AgentUpdateInput as AgentUpdateInputType } from "@/contracts/agent";
import { DRAFT_STATE_EVENT, notifyDraftState, type DraftStateDetail } from "@/lib/draft-state";
import { updateAgentAction } from "@/server/actions/update-agent";

interface MetadataSnapshot {
  name: string;
  description: string;
  updatedAt: string;
}

export function AgentMetadataEditor({ agentId, initialName, initialDescription, initialUpdatedAt }: {
  agentId: string;
  initialName: string;
  initialDescription: string | null;
  initialUpdatedAt: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [baseline, setBaseline] = useState<MetadataSnapshot>({ name: initialName, description: initialDescription ?? "", updatedAt: initialUpdatedAt });
  const [lastSaved, setLastSaved] = useState<MetadataSnapshot | null>(null);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [pending, setPending] = useState(false);
  const [uncertainRequest, setUncertainRequest] = useState<AgentUpdateInputType | null>(null);
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const normalizedName = name.trim();
  const normalizedDescription = description.trim();
  const dirty = editing && (normalizedName !== baseline.name || normalizedDescription !== baseline.description.trim());
  const draftStateKey = `agent-info:${agentId}`;

  useEffect(() => notifyDraftState({ agentId: draftStateKey, dirty: dirty || uncertainRequest !== null }), [draftStateKey, dirty, uncertainRequest]);
  useEffect(() => () => notifyDraftState({ agentId: draftStateKey, dirty: false }), [draftStateKey]);
  useEffect(() => {
    if (!dirty && !uncertainRequest) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty, uncertainRequest]);
  useEffect(() => {
    const receiveDraftState = (event: Event) => {
      const detail = (event as CustomEvent<DraftStateDetail>).detail;
      if (detail?.agentId === agentId) setCanvasDirty(detail.dirty);
    };
    window.addEventListener(DRAFT_STATE_EVENT, receiveDraftState);
    return () => window.removeEventListener(DRAFT_STATE_EVENT, receiveDraftState);
  }, [agentId]);

  function openEditor() {
    const current = lastSaved && lastSaved.updatedAt > initialUpdatedAt
      ? lastSaved
      : { name: initialName, description: initialDescription ?? "", updatedAt: initialUpdatedAt };
    setBaseline(current);
    setName(current.name);
    setDescription(current.description);
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  function discardChanges() {
    setName(baseline.name);
    setDescription(baseline.description);
    setError(null);
    setEditing(false);
    setDiscardOpen(false);
  }

  async function saveInformation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || canvasDirty || (!dirty && !uncertainRequest)) return;
    const parsed = AgentUpdateInput.safeParse({
      agentId,
      name: normalizedName,
      description: normalizedDescription || null,
      expectedUpdatedAt: baseline.updatedAt,
    });
    if (!parsed.success) {
      setError("请填写助手名称，并检查名称和说明的长度。");
      return;
    }
    const request = uncertainRequest ?? parsed.data;
    setPending(true);
    setError(null);
    try {
      const result = await updateAgentAction(request);
      if (result.ok) {
        setLastSaved({ name: request.name, description: request.description ?? "", updatedAt: result.updatedAt });
        setUncertainRequest(null);
        setEditing(false);
        setNotice("基本信息已保存");
        router.refresh();
      } else {
        setUncertainRequest(null);
        setError(result.error);
      }
    } catch {
      setUncertainRequest(request);
      setError("暂时无法确认是否保存成功。请保留本页，核对时会重用上次提交的内容。");
    } finally {
      setPending(false);
    }
  }

  return <div className="flex max-w-2xl flex-col gap-2">
    {!editing ? (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={openEditor} className="inline-flex h-9 w-fit items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-indigo-200 hover:text-indigo-700">
          <Pencil aria-hidden="true" className="size-4" />编辑名称和说明
        </button>
        {notice ? <span role="status" className="text-sm text-emerald-700">{notice}</span> : null}
      </div>
    ) : (
      <form onSubmit={saveInformation} noValidate className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5" aria-label="编辑助手基本信息">
        <h2 className="text-sm font-bold text-slate-900">编辑基本信息</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">名称和说明会显示在助手列表与运行记录中；保存后才会更新。</p>
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">助手名称
            <input aria-label="编辑助手名称" required maxLength={60} value={name} readOnly={Boolean(uncertainRequest)} disabled={pending}
              onChange={(event) => { setName(event.target.value); setError(null); }}
              className="h-10 min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">助手说明
            <textarea aria-label="编辑助手说明" maxLength={200} rows={3} value={description} readOnly={Boolean(uncertainRequest)} disabled={pending}
              onChange={(event) => { setDescription(event.target.value); setError(null); }}
              placeholder="简要说明这个助手负责什么工作"
              className="min-w-0 resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
          <span>{normalizedName ? "本页修改尚未保存到工作区" : "助手名称不能为空"}</span>
          <span>说明 {description.length}/200 字</span>
        </div>
        {canvasDirty ? <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">流程还有未保存修改。请先保存或放弃流程修改，再保存基本信息。</p> : null}
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={pending || canvasDirty || (!dirty && !uncertainRequest) || !normalizedName}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400">
            <Save aria-hidden="true" className="size-4" />{pending ? "保存中…" : uncertainRequest ? "核对上次保存" : "保存信息"}
          </button>
          <button type="button" disabled={pending || Boolean(uncertainRequest)} onClick={() => { if (dirty) setDiscardOpen(true); else discardChanges(); }}
            className="inline-flex h-10 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">取消</button>
        </div>
      </form>
    )}
    <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} title="放弃基本信息修改？"
      description="尚未保存的名称和说明会恢复到打开表单时的内容，不会修改工作区中的助手。"
      confirmLabel="放弃修改" onConfirm={discardChanges} />
  </div>;
}
