"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, CircleAlert, KeyRound, Pencil, PlugZap, Plus, Server, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ModelConnectionView } from "@/contracts/connections";
import { deleteModelConnectionAction, saveModelConnectionAction, testModelConnectionAction } from "@/server/actions/model-connections";

export function ConnectionManager({ initial, encryptionReady }: { initial: ModelConnectionView[]; encryptionReady: boolean }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelIdsText, setModelIdsText] = useState("");
  const [isDefaultCompile, setIsDefaultCompile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unknownOutcome, setUnknownOutcome] = useState(false);
  const deletingConnection = initial.find((connection) => connection.id === confirmDeleteId);

  function resetForm() {
    setEditingId(null);
    setName("");
    setBaseUrl("");
    setApiKey("");
    setModelIdsText("");
    setIsDefaultCompile(false);
  }

  function openCreate() {
    if (editingId) resetForm();
    setError(null);
    setNotice(null);
    setUnknownOutcome(false);
    setFormOpen(true);
  }

  function openEdit(connection: ModelConnectionView) {
    setEditingId(connection.id);
    setName(connection.name);
    setBaseUrl(connection.baseUrl);
    setApiKey("");
    setModelIdsText(connection.modelIds.join(", "));
    setIsDefaultCompile(connection.isDefaultCompile);
    setError(null);
    setNotice(null);
    setUnknownOutcome(false);
    setFormOpen(true);
  }

  async function handleSave() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setUnknownOutcome(false);
    try {
      const result = await saveModelConnectionAction({
        ...(editingId ? { id: editingId } : {}),
        name, baseUrl, apiKey,
        modelIds: [...new Set(modelIdsText.split(/[,，\n]/).map((part) => part.trim()).filter(Boolean))],
        isDefaultCompile,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      resetForm();
      setFormOpen(false);
      setNotice("连接已保存。使用前请测试连接；保存本身不代表服务可用。");
      router.refresh();
    } catch {
      setUnknownOutcome(true);
      setError("暂时无法确认连接是否保存。请先核对连接列表，再决定是否重试，以免重复创建。");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(connection: ModelConnectionView) {
    if (busy) return;
    const modelId = connection.modelIds[0];
    if (!modelId) {
      setError(`「${connection.name}」没有可测试的模型，请先编辑模型列表。`);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(`正在测试「${connection.name}」；页面所见首个模型是「${modelId}」…`);
    try {
      const result = await testModelConnectionAction(connection.id);
      setNotice(result.ok ? `「${connection.name}」本次测试已收到回复（页面所见首个模型：「${modelId}」）。${connection.modelIds.length > 1 ? "其他模型尚未测试。" : "这不是持续可用保证。"}` : null);
      if (!result.ok) setError(`「${connection.name}」本次测试未通过（页面所见首个模型：「${modelId}」）：${result.error}`);
    } catch {
      setNotice(null);
      setError(`暂时无法确认「${connection.name}」本次测试结果（页面所见首个模型：「${modelId}」）。请检查网络后重试，不要把这次测试当作成功。`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setUnknownOutcome(false);
    try {
      const result = await deleteModelConnectionAction(id);
      if (!result.ok) {
        setConfirmDeleteId(null);
        setError(result.error);
        return;
      }
      if (editingId === id) resetForm();
      setConfirmDeleteId(null);
      setNotice("连接已删除");
      router.refresh();
    } catch {
      setConfirmDeleteId(null);
      setUnknownOutcome(true);
      setError("暂时无法确认连接是否已删除。请先刷新列表核对状态，再决定是否重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="text-base font-bold text-slate-950">已接入的模型服务</h2><p className="mt-1 text-sm leading-6 text-slate-500">管理可供助手使用的模型。密钥只显示末尾提示，保存后建议先测试连接。</p></div>
        <button type="button" disabled={busy || !encryptionReady} onClick={openCreate} className="inline-flex h-10 w-fit items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><Plus className="size-4" />添加模型连接</button>
      </div>
      {!encryptionReady ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">当前服务缺少有效的模型加密主钥，已保存的连接暂时不能测试或使用。请让管理员恢复原主钥并重启服务；不要用模型服务的接口密钥代替。</p> : null}
      {!formOpen && error ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><CircleAlert className="size-4" /><span className="min-w-0 flex-1">{error}</span>{unknownOutcome ? <button type="button" onClick={() => router.refresh()} className="font-semibold underline underline-offset-2">刷新列表核对</button> : null}</div> : null}
      {notice ? <p role="status" className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${busy ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{busy ? <PlugZap className="size-4" /> : <CheckCircle2 className="size-4" />}{notice}</p> : null}
      {initial.length === 0 ? <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center"><Server className="mx-auto size-7 text-slate-400" /><p className="mt-3 text-sm font-medium text-slate-700">还没有接入模型服务</p><p className="mt-1 text-xs leading-5 text-slate-500">先添加连接，再测试是否可以收到模型回复；保存本身不代表服务可用。</p></div> : (
        <ul className="flex flex-col gap-3">
          {initial.map((connection) => <li key={connection.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-200 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><Server className="size-5" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-all text-sm font-semibold text-slate-900">{connection.name}</h3>{connection.isDefaultCompile ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">创建助手默认使用</span> : null}</div><p className="mt-2 break-all text-xs text-slate-500">{connection.baseUrl}</p><p className="mt-1 text-xs text-slate-500">{connection.modelIds.length} 个模型 · 密钥 {connection.apiKeyHint}</p><p className="mt-1 break-all text-xs text-slate-500">{connection.modelIds.join("、")}</p><p className="mt-1 text-xs text-slate-500">当前测试只检查首个模型{connection.modelIds[0] ? `「${connection.modelIds[0]}」` : "；请先填写模型列表"}。</p></div></div>
              <div className="flex shrink-0 flex-wrap gap-2 text-sm">
                <button type="button" aria-label={`编辑「${connection.name}」`} disabled={busy || !encryptionReady} onClick={() => openEdit(connection)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"><Pencil className="size-3.5" />编辑</button>
                <button type="button" aria-label={`测试「${connection.name}」的首个模型`} disabled={busy || !encryptionReady || connection.modelIds.length === 0} onClick={() => void handleTest(connection)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50"><PlugZap className="size-3.5" />测试首个模型</button>
                <button type="button" aria-label={`删除「${connection.name}」`} disabled={busy} onClick={() => setConfirmDeleteId(connection.id)} className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"><Trash2 className="size-3.5" />删除</button>
              </div>
            </div>
          </li>)}
        </ul>
      )}
      <Dialog.Root open={formOpen} onOpenChange={(open) => { if (!busy) setFormOpen(open); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col overflow-x-hidden bg-slate-50 shadow-2xl outline-none">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6"><div><p className="text-xs font-bold tracking-[0.16em] text-indigo-600">模型服务</p><Dialog.Title className="mt-1 text-xl font-bold text-slate-950">{editingId ? "编辑模型连接" : "添加模型连接"}</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-slate-500">保存后请测试能否收到模型回复，测试成功前不要当作可用连接。</Dialog.Description></div><Dialog.Close aria-label="关闭连接面板" disabled={busy} className="grid size-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X className="size-5" /></Dialog.Close></header>
            <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }} className="flex min-h-0 flex-1 flex-col">
              <fieldset disabled={busy || !encryptionReady} className="grid flex-1 content-start gap-4 overflow-y-auto p-5 sm:p-6">
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">连接名称<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={50} placeholder="例如：生产模型服务" className="h-10 rounded-xl border border-slate-300 bg-white px-3 font-normal" /></label>
                <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">服务地址<input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required placeholder="供应商提供的模型接口地址" className="h-10 rounded-xl border border-slate-300 bg-white px-3 font-normal" /></label>
                <div><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">密钥<span className="relative"><KeyRound className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required={!editingId} minLength={8} aria-describedby={editingId ? "key-help" : undefined} className="h-10 w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 font-normal" /></span></label>{editingId ? <p id="key-help" className="mt-1 text-xs text-slate-500">留空则保留原密钥；更改服务地址时必须填写新密钥。</p> : null}</div>
                <div><label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">模型列表<input value={modelIdsText} onChange={(event) => setModelIdsText(event.target.value)} required aria-describedby="model-list-help" placeholder="填写模型名称，多个模型用逗号分隔" className="h-10 rounded-xl border border-slate-300 bg-white px-3 font-normal" /></label><p id="model-list-help" className="mt-1 text-xs leading-5 text-slate-500">当前测试只检查列表中的第一个模型；其他模型的可用性请在实际使用前核对。</p></div>
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600"><input type="checkbox" checked={isDefaultCompile} onChange={(event) => setIsDefaultCompile(event.target.checked)} className="size-4 accent-indigo-600" /><span><span className="font-medium text-slate-700">设为创建助手时的默认连接</span><span className="mt-0.5 block text-xs text-slate-500">新助手生成流程时优先使用这条连接；设为默认不代表已通过测试。</span></span></label>
                {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><p>{error}</p>{unknownOutcome ? <button type="button" onClick={() => { setFormOpen(false); router.refresh(); }} className="mt-2 font-semibold underline underline-offset-2">核对连接列表</button> : null}</div> : null}
              </fieldset>
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-6"><p className="text-xs leading-5 text-slate-500">关闭面板不会提交；未保存的输入在本页暂时保留。</p><div className="ml-auto flex gap-2"><button type="button" disabled={busy} onClick={() => setFormOpen(false)} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">取消</button><button type="submit" disabled={busy || !encryptionReady || !name.trim() || !baseUrl.trim() || (!editingId && !apiKey.trim()) || !modelIdsText.trim()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-400"><PlugZap className="size-4" />{busy ? "正在保存…" : editingId ? "保存修改" : "保存连接"}</button></div></footer>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmDialog open={Boolean(deletingConnection)} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }} title={deletingConnection ? `删除「${deletingConnection.name}」？` : "删除模型连接？"} description="删除后，使用这条连接的已发布版本将无法运行。请先检查相关助手是否仍在使用。" confirmLabel="确认删除" pending={busy} onConfirm={() => { if (deletingConnection) void handleDelete(deletingConnection.id); }} />
    </div>
  );
}
