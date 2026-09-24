"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ModelConnectionView } from "@/contracts/connections";
import { deleteModelConnectionAction, saveModelConnectionAction, testModelConnectionAction } from "@/server/actions/model-connections";

export function ConnectionManager({ initial }: { initial: ModelConnectionView[] }) {
  const router = useRouter();
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

  function resetForm() {
    setEditingId(null);
    setName("");
    setBaseUrl("");
    setApiKey("");
    setModelIdsText("");
    setIsDefaultCompile(false);
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    setNotice(null);
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
      setNotice("连接已保存");
      router.refresh();
    } catch {
      setError("请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(id: string) {
    setBusy(true);
    setError(null);
    setNotice("正在测试连接…");
    try {
      const result = await testModelConnectionAction(id);
      setNotice(result.ok ? "连接正常，已收到模型回复" : null);
      if (!result.ok) setError(result.error);
    } catch {
      setNotice(null);
      setError("请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await deleteModelConnectionAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (editingId === id) resetForm();
      setConfirmDeleteId(null);
      setNotice("连接已删除");
      router.refresh();
    } catch {
      setError("请求失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-gray-200 bg-white p-4 sm:p-6">
        <h2 className="mb-4 text-sm font-semibold">{editingId ? "编辑模型连接" : "接入模型服务"}</h2>
        <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
          <fieldset disabled={busy} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              连接名称
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={50}
                className="rounded-md border border-gray-300 px-3 py-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              服务地址
              <input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required
                placeholder="供应商提供的模型接口地址" className="rounded-md border border-gray-300 px-3 py-2" />
            </label>
            <div>
              <label className="flex flex-col gap-1 text-sm">
                密钥
                <input type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)}
                  required={!editingId} minLength={8} aria-describedby={editingId ? "key-help" : undefined}
                  className="rounded-md border border-gray-300 px-3 py-2" />
              </label>
              {editingId ? <p id="key-help" className="mt-1 text-xs text-gray-500">留空则保留原密钥；更改服务地址时必须填写新密钥。</p> : null}
            </div>
            <label className="flex flex-col gap-1 text-sm">
              模型列表
              <input value={modelIdsText} onChange={(event) => setModelIdsText(event.target.value)} required
                placeholder="填写模型名称，多个模型用逗号分隔" className="rounded-md border border-gray-300 px-3 py-2" />
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={isDefaultCompile} onChange={(event) => setIsDefaultCompile(event.target.checked)} className="mt-1" />
              设为创建助手时的默认连接
            </label>
            <div className="flex gap-3">
              <button type="submit" disabled={busy || !name.trim() || !baseUrl.trim() || (!editingId && !apiKey.trim()) || !modelIdsText.trim()}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:bg-gray-400">
                {busy ? "处理中…" : editingId ? "保存修改" : "保存连接"}
              </button>
              {editingId ? <button type="button" onClick={resetForm} className="rounded-md border px-4 py-2 text-sm">取消编辑</button> : null}
            </div>
          </fieldset>
        </form>
      </section>
      {error ? <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-gray-700">{notice}</p> : null}
      {initial.length === 0 ? <p className="text-sm text-gray-600">还没有接入模型服务，保存连接后，发布助手时就能选择这条连接中的模型。</p> : (
        <ul className="flex flex-col gap-3">
          {initial.map((connection) => (
            <li key={connection.id} className="min-w-0 rounded-lg border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-all text-sm font-medium">{connection.name}</h3>
                {connection.isDefaultCompile ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">创建助手默认使用</span> : null}
              </div>
              <p className="mt-2 break-all text-xs text-gray-500">{connection.baseUrl}</p>
              <p className="mt-1 text-xs text-gray-500">{connection.modelIds.length} 个模型 · 密钥 {connection.apiKeyHint}</p>
              <p className="mt-1 break-all text-xs text-gray-500">{connection.modelIds.join("、")}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <button type="button" disabled={busy} onClick={() => {
                  setEditingId(connection.id); setName(connection.name); setBaseUrl(connection.baseUrl); setApiKey("");
                  setModelIdsText(connection.modelIds.join(", ")); setIsDefaultCompile(connection.isDefaultCompile);
                  setError(null); setNotice(null); setConfirmDeleteId(null);
                }} className="text-gray-600 hover:text-gray-900 disabled:opacity-50">编辑</button>
                <button type="button" disabled={busy} onClick={() => void handleTest(connection.id)} className="text-gray-600 hover:text-gray-900 disabled:opacity-50">测试连接</button>
                <button type="button" disabled={busy} onClick={() => setConfirmDeleteId(connection.id)} className="text-red-600 hover:text-red-800 disabled:opacity-50">删除</button>
              </div>
              {confirmDeleteId === connection.id ? (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <p>删除后，使用这条连接的已发布版本将无法运行。确定删除吗？</p>
                  <div className="mt-2 flex gap-4">
                    <button type="button" disabled={busy} onClick={() => void handleDelete(connection.id)}>确认删除</button>
                    <button type="button" disabled={busy} onClick={() => setConfirmDeleteId(null)}>取消</button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
