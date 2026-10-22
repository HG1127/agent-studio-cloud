"use client";

import { startTransition, useId, useLayoutEffect, useRef, useState } from "react";
import type { AgentTargetOption } from "@/contracts/agent";
import {
  PublicToolCallInput, PublicToolManageInput, type PublicToolCallReceipt, type PublicToolView,
  type PublicToolFailure, type PublicToolListResult,
} from "@/contracts/public-agent-tool";
import type { PublicToolKeyManagementView } from "@/contracts/public-tool-key-management";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StructuredInputEditor } from "@/features/inputs/StructuredInputEditor";
import { useStructuredInputSession } from "@/features/inputs/use-structured-input-session";
import { prepareRunLauncherInput, runLauncherFieldLabel } from "@/features/agents/run-launcher-input";
import { StructuredRunValue } from "@/features/runs/StructuredRunValue";
import { notifyDraftState } from "@/lib/draft-state";
import { PublicToolInventory } from "./PublicToolInventory";
import { PublicToolServerGuide } from "./PublicToolServerGuide";
import {
  changeManagedTool, readCallableTool, readManagedToolKeys, readManagedTools, readToolCall,
  submitToolCall, validCallCredential, validManagementCredential, newPublicToolRequestId,
} from "./public-tool-client";

const FIELD = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100";
const BUTTON = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";
const TOOL_STATE = { draft: "尚未开放", enabled: "已开放", disabled: "已停用" };
const CALL_STATE: Record<PublicToolCallReceipt["state"], string> = {
  accepted: "请求已登记", start_unknown: "启动结果待核对", unknown: "结果待核对", queued: "排队中", running: "处理中",
  waiting_approval: "等待负责人确认", waiting_event: "等待继续条件", completed: "已完成", failed: "执行失败", cancelled: "已取消",
};
type ManageAttempt = { input: PublicToolManageInput; credential: string; description: string; unknown: boolean; submitted: boolean };
type CallAttempt = { input: PublicToolCallInput; credential: string; preview: PublicToolView; phase: "confirm" | "unknown" | "received"; submitted: boolean };

function name(value: string, fallback: string) {
  return !value.trim() || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.trim()) ? fallback : value.trim();
}
function failure(value: PublicToolFailure) {
  return { unauthorized: "凭据无效、已失效或入口未配置，请核对使用的凭据。", invalid: "填写内容或发布版本不符合要求，请核对本次内容。",
    conflict: "保存内容或原请求已变化，请核对原请求和已保存状态；不会自动更换请求。", not_found: "没有读到所选工具或请求，请核对原关联。",
    unavailable: "操作结果暂时无法核对，请保留原请求。", resource_limit: "数量或执行额度暂不可用，请核对后沿用原请求。" }[value.code];
}
function useProtectedPage(key: string, dirty: boolean) {
  useLayoutEffect(() => { notifyDraftState({ agentId: key, dirty }); }, [key, dirty]);
  useLayoutEffect(() => () => notifyDraftState({ agentId: key, dirty: false }), [key]);
  useLayoutEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
}

export function PublishedToolManager({ targets }: { targets: AgentTargetOption[] | null }) {
  const instance = useId();
  const [credential, setCredential] = useState("");
  const [list, setList] = useState<Extract<PublicToolListResult, { ok: true }> | null>(null);
  const [listCurrentUnknown, setListCurrentUnknown] = useState(false);
  const [inventorySession, setInventorySession] = useState(0);
  const [selected, setSelected] = useState<PublicToolView | null>(null);
  const [definitionHandoff, setDefinitionHandoff] = useState<{ toolId: string; revision: number } | null>(null);
  const publicationTarget = useRef<HTMLSelectElement | null>(null);
  const [keys, setKeys] = useState<PublicToolKeyManagementView | null>(null);
  const [keysReadAt, setKeysReadAt] = useState<number | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [toolName, setToolName] = useState(""), [description, setDescription] = useState("");
  const [targetId, setTargetId] = useState(""), [keyName, setKeyName] = useState(""), [expiry, setExpiry] = useState("");
  const [attempt, setAttempt] = useState<ManageAttempt | null>(null);
  const [busy, setBusy] = useState(false), [callLocked, setCallLocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [plainToken, setPlainToken] = useState<string | null>(null), [revealed, setRevealed] = useState(false);
  const live = useRef(false), epoch = useRef(0), working = useRef(false), active = useRef<ManageAttempt | null>(null);
  const callProtection = useRef({ dirty: false, locked: false });
  const chosen = targets?.find((target) => target.versionId.toLowerCase() === targetId);
  const locked = busy || attempt !== null || callLocked;
  const canContinueDefinition = selected?.toolId === definitionHandoff?.toolId && selected?.revision === definitionHandoff?.revision
    && selected?.status === "draft" && selected.publication === null && attempt === null && !busy;
  const dirty = Boolean(credential || toolName || description || targetId || keyName || expiry || attempt || plainToken);
  useProtectedPage(`public-tool-manager:${instance}`, dirty);
  useLayoutEffect(() => {
    live.current = true; epoch.current += 1;
    return () => { live.current = false; epoch.current += 1; active.current = null; };
  }, []);

  function resetCredential(value: string) {
    if (working.current || active.current || callProtection.current.locked) return;
    if (callProtection.current.dirty && !window.confirm("更换管理凭据会关闭当前调用核对并清除本页临时凭据，已登记任务不会取消。确定继续吗？")) return;
    epoch.current += 1; setCredential(value); setList(null); setListCurrentUnknown(false); setInventorySession((current) => current + 1); setSelected(null); setDefinitionHandoff(null); setKeys(null); setKeysReadAt(null); setPlainToken(null); setRevealed(false); setError(null); setNotice(null);
  }
  async function read(kind: "list" | "keys") {
    if (!live.current || working.current || active.current || callProtection.current.locked || !validManagementCredential(credential)) return;
    const selectedId = selected?.toolId;
    if (kind === "keys" && !selectedId) return;
    working.current = true; setBusy(true); setError(null);
    if (kind === "list") { setListCurrentUnknown(true); setNotice(null); }
    const stamp = ++epoch.current;
    try {
      if (kind === "list") {
        const result = await readManagedTools(credential);
        if (!live.current || stamp !== epoch.current) return;
        if (!result.ok) { setDefinitionHandoff(null); setError(failure(result)); return; }
        setDefinitionHandoff((current) => {
          if (!current) return null;
          const currentTool = result.tools.find((tool) => tool.toolId === current.toolId);
          return currentTool?.revision === current.revision && currentTool.status === "draft" && currentTool.publication === null ? current : null;
        });
        setList(result); setListCurrentUnknown(false); setNotice("工具清单已重新读取；已有填写和原请求没有自动提交。");
      } else if (selectedId) {
        const result = await readManagedToolKeys(credential, selectedId);
        if (!live.current || stamp !== epoch.current) return;
        if (!result.ok) { setDefinitionHandoff(null); setError(failure(result)); setKeys(null); setKeysReadAt(null); return; }
        setKeys(result); setKeysReadAt(Date.now()); setSelected(result.tool); setNotice("凭据元数据已重新读取，不返回或恢复凭据明文。");
      }
    } catch {
      if (live.current && stamp === epoch.current) { setDefinitionHandoff(null); setError("读取暂时无法确认；不能按没有记录显示。请手动重新读取。"); if (kind === "keys") { setKeys(null); setKeysReadAt(null); } }
    } finally { if (live.current && stamp === epoch.current) { working.current = false; setBusy(false); } }
  }
  function selectTool(tool: PublicToolView) {
    if (working.current || active.current || callProtection.current.locked) return;
    if (selected?.toolId === tool.toolId) { setNotice("仍在核对同一工具；本页填写、临时凭据与原调用保持不变。"); return; }
    if ((plainToken || targetId || keyName || expiry || callProtection.current.dirty) && !window.confirm("切换工具会清除当前未提交填写、调用核对和一次性凭据明文；已登记任务不会取消。确定切换吗？")) return;
    epoch.current += 1; setSelected(tool); setDefinitionHandoff(null); setKeys(null); setKeysReadAt(null); setTargetId(""); setKeyName(""); setExpiry(""); setPlainToken(null); setRevealed(false); setError(null); setNotice(null);
  }
  function prepare(raw: unknown, summary: string) {
    if (!live.current || working.current || active.current || callProtection.current.locked || !validManagementCredential(credential)) return;
    const parsed = PublicToolManageInput.safeParse(raw);
    if (!parsed.success) { setError("请填写完整名称、有效版本或未来到期时间后再确认。"); return; }
    const content = JSON.stringify(parsed.data);
    if (content.includes(credential) || /\bpat_[a-f0-9]{64}\b/.test(content)) { setError("工具名称、说明和请求内容不能包含凭据。"); return; }
    if (parsed.data.operation !== "create") setDefinitionHandoff(null);
    const next = { input: parsed.data, credential, description: summary, unknown: false, submitted: false };
    active.current = next; setAttempt(next); setError(null); setNotice(null);
  }
  function command(operation: "publish" | "disable" | "mint-key" | "revoke-key", keyId?: string) {
    if (!selected || !live.current || working.current || active.current || callProtection.current.locked) return;
    const requestId = newPublicToolRequestId();
    if (!requestId) { setError("本次请求暂时无法准备，尚未发送。填写仍保留，请重新尝试。"); return; }
    const base = { operation, toolId: selected.toolId, expectedRevision: selected.revision, requestId, confirmed: true };
    if (operation === "publish") {
      if (!chosen) { setError("请明确选择已读取的正式版本；不会默认选择最新版本。"); return; }
      prepare({ ...base, agentId: chosen.agentId, versionId: chosen.versionId }, `把「${name(selected.name, "所选工具")}」开放为「${name(chosen.agentName, "所选助手")}」的版本 ${chosen.version}。版本编号和原工具修订已固定，不使用当前草稿。`);
    } else if (operation === "mint-key") {
      if (plainToken) { setError("请先妥善保存并清除上一份一次性凭据明文。"); return; }
      let expiresAt: string | null = null;
      if (expiry) {
        const date = new Date(expiry);
        if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() || date.getTime() > Date.now() + 365 * 86400000) { setError("到期时间须在未来一年以内。"); return; }
        expiresAt = date.toISOString();
      }
      prepare({ ...base, name: keyName, expiresAt }, `为「${name(selected.name, "所选工具")}」发放一份调用凭据。明文仅首次返回，不写入网址或浏览器存储；请立即妥善保管。`);
    } else if (operation === "revoke-key") prepare({ ...base, keyId }, "撤销所选凭据后，持有人不能再使用它调用或读取工具回执。已经登记的任务不会因此取消。");
    else prepare(base, "停用后工具凭据不能再调用或读取回执；已登记任务不会自动取消。重新开放需要明确选择正式版本。");
  }
  function defineTool() {
    if (!live.current || working.current || active.current || callProtection.current.locked) return;
    const requestId = newPublicToolRequestId();
    if (!requestId) { setError("本次请求暂时无法准备，尚未发送。填写仍保留，请重新尝试。"); return; }
    prepare({ operation: "create", requestId, confirmed: true, name: toolName, description }, `保存「${name(toolName, "新工具")}」的名称和说明；这次只定义工具，不发布、不生成凭据或任务。`);
  }
  async function execute() {
    const original = active.current;
    if (!live.current || !original || working.current || callProtection.current.locked) return;
    const request = { ...original, submitted: true };
    active.current = request; setAttempt(request);
    working.current = true; setBusy(true); setError(null);
    const stamp = epoch.current;
    try {
      const result = await changeManagedTool(request.credential, request.input);
      if (!live.current || stamp !== epoch.current || active.current !== request) return;
      if (!result.ok) {
        setError(failure(result));
        if (original.submitted || result.retryable || ["unavailable", "resource_limit"].includes(result.code)) { const next = { ...request, unknown: true }; active.current = next; setAttempt(next); }
        else { active.current = null; setAttempt(null); }
        return;
      }
      setSelected(result.tool); setKeys(null); setKeysReadAt(null); active.current = null; setAttempt(null);
      setDefinitionHandoff(request.input.operation === "create" && result.tool.revision === result.recordedRevision
        && result.tool.status === "draft" && result.tool.publication === null ? { toolId: result.tool.toolId, revision: result.recordedRevision } : null);
      setNotice(`原管理请求已确认记账。${result.tool.revision > result.recordedRevision ? "工具后来还有变更；当前状态不等于原请求当时的状态。" : "列表与凭据清单可手动重新读取。"}${request.input.operation === "mint-key" && !result.token ? " 原请求未再返回明文；凭据可能已发放，刷新只能查看元数据并撤销，不能恢复明文。" : ""}`);
      if (result.token) { setPlainToken(result.token); setRevealed(false); }
      if (request.input.operation === "create") { setToolName(""); setDescription(""); setNewOpen(false); }
    } catch {
      if (live.current && stamp === epoch.current && active.current === request) { const next = { ...request, unknown: true }; active.current = next; setAttempt(next); setError("写入结果暂时未知；原请求及完整内容已保留，未自动重发。离开页面后无法从浏览器恢复，请先核对或保存无凭据的请求信息。"); }
    } finally { if (live.current && stamp === epoch.current) { working.current = false; setBusy(false); } }
  }
  async function copy(value: string) {
    const stamp = epoch.current;
    try { await navigator.clipboard.writeText(value); if (live.current && stamp === epoch.current) setNotice("已复制，请妥善保管；本页没有写入浏览器存储。"); }
    catch { if (live.current && stamp === epoch.current) setError("复制失败，请在本页手动选中并复制，不会在提示中重复显示凭据。"); }
  }
  function clear() {
    if (working.current || active.current || callProtection.current.locked) return;
    if ((dirty || callProtection.current.dirty) && !window.confirm("清除本页操作会移除临时凭据和未提交填写，不取消已登记任务，也不撤销已发放凭据。确定清除吗？")) return;
    epoch.current += 1; setCredential(""); setList(null); setListCurrentUnknown(false); setInventorySession((current) => current + 1); setSelected(null); setDefinitionHandoff(null); setKeys(null); setKeysReadAt(null); setToolName(""); setDescription(""); setTargetId(""); setKeyName(""); setExpiry(""); setPlainToken(null); setRevealed(false); setNotice(null); setError(null); setNewOpen(false);
  }

  return <section id="published-tool-management" aria-label="已发布工具管理" className="content-card min-w-0 space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="section-title">把正式助手开放为网页工具</h2><p className="mt-2 text-sm leading-6 text-slate-600">定义工具 → 绑定正式版本 → 发放调用凭据 → 真实调用 → 核对成果。本站操作不等于第三方网页嵌入或跨域开放。</p></div><button type="button" className={BUTTON} disabled={locked} onClick={clear}>清除本页操作</button></div>
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><label className="block text-sm font-semibold">管理凭据<input aria-label="管理凭据" type="password" autoComplete="off" spellCheck={false} maxLength={256} value={credential} disabled={locked} onChange={(event) => resetCredential(event.target.value)} className={FIELD} /></label><p className="mt-2 text-xs leading-5 text-slate-600">由管理员在本机环境配置后提供。只用于管理和读取清单，不能用于调用；不自动读取服务端密钥，不保存到网址或浏览器存储。</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={locked || !validManagementCredential(credential)} onClick={() => startTransition(() => { void read("list"); })}>读取工具清单</button><button type="button" className={PRIMARY} disabled={locked || !validManagementCredential(credential)} onClick={() => setNewOpen(true)}>定义新工具</button></div></div>
    {busy ? <p role="status">正在核对本次操作，请勿重复提交…</p> : null}
    {error ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{error}</p> : null}
    {notice ? <p role="status" className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm leading-6">{notice}</p> : null}
    {canContinueDefinition ? <section aria-label="工具定义后的下一步" className="min-w-0 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <h3 className="text-sm font-semibold text-indigo-950">工具定义已保存，尚未开放</h3>
      <p className="text-sm leading-6 text-indigo-900">下一步：明确选择正式助手版本。保存定义不会自动发布、发放凭据或运行助手。</p>
      {targets === null ? <p className="text-sm leading-6 text-amber-950">正式版本来源读取失败，暂时不能继续选择；已保存的工具定义保留。</p>
        : targets.length === 0 ? <p className="text-sm leading-6 text-indigo-900">没有读到可发布的正式版本。请先为助手保存正式版本，再重新读取页面；本页不会替你创建或选择版本。</p>
          : <button type="button" className={PRIMARY} disabled={locked} aria-controls={instance + "-publication-target"}
            onClick={() => { if (!locked) publicationTarget.current?.focus(); }}>继续选择正式版本</button>}
    </section> : null}
    {attempt?.unknown ? <div role="region" aria-label="原管理请求待核对" className="rounded-xl border border-amber-300 p-4"><p className="text-sm leading-6">原写请求结果待核对。不能编辑或更换请求；下面操作是沿用同请求再次执行写操作，不是只读刷新。</p><button type="button" className={BUTTON} disabled={busy} onClick={() => { const current = active.current; if (current) { const next = { ...current, unknown: false }; active.current = next; setAttempt(next); } }}>核对并重试原写请求</button><details className="mt-3"><summary className="text-sm">开发者请求信息（不含凭据）</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(attempt.input, null, 2)}</pre><button type="button" className={BUTTON} onClick={() => { void copy(JSON.stringify(attempt.input)); }}>复制原请求信息</button></details></div> : null}
    {newOpen ? <form aria-label="定义新工具" onSubmit={(event) => { event.preventDefault(); defineTool(); }} className="grid gap-3 rounded-xl border border-slate-200 p-4"><label className="text-sm">工具名称<input value={toolName} maxLength={200} disabled={locked} onChange={(event) => setToolName(event.target.value)} className={FIELD} /></label><label className="text-sm">工具说明<textarea value={description} maxLength={2000} disabled={locked} onChange={(event) => setDescription(event.target.value)} className={FIELD} rows={3} /></label><div className="flex gap-2"><button type="submit" className={PRIMARY} disabled={locked || !toolName.trim()}>保存工具定义</button><button type="button" className={BUTTON} disabled={locked} onClick={() => { if (!(toolName || description) || window.confirm("收起会保留本页未提交填写，不会保存或发布工具。确定收起吗？")) setNewOpen(false); }}>收起定义表单</button></div></form> : null}
    <PublicToolInventory key={inventorySession} list={list} targets={targets} currentUnknown={listCurrentUnknown} selectedId={selected?.toolId ?? null} locked={locked} onSelect={selectTool} />
    {selected ? <section aria-label="所选工具操作" className="min-w-0 space-y-4 rounded-xl border border-indigo-200 p-4"><h3 className="break-words font-semibold">{name(selected.name, "所选工具")} · {TOOL_STATE[selected.status]}</h3><p className="text-sm text-slate-600">最后核对的工具修订为 {selected.revision}。写操作将核对该修订；其他人改动后会拒绝，不自动覆盖。</p><div className="grid min-w-0 gap-4 xl:grid-cols-2"><div className="min-w-0 space-y-3"><h4 className="font-semibold">绑定与开放</h4>{targets === null ? <p role="alert">正式版本来源读取失败，当前不能选择发布；已定义工具和调用核对可独立使用。</p> : <label className="block text-sm">发布到哪个正式版本<select ref={publicationTarget} id={instance + "-publication-target"} aria-label="发布到哪个正式版本" value={targetId} disabled={locked} onChange={(event) => setTargetId(event.target.value)} className={FIELD}><option value="">请明确选择，不默认最新版本</option>{targets.map((target) => <option key={target.versionId} value={target.versionId.toLowerCase()}>{name(target.agentName, "已读取助手")} · 版本 {target.version}</option>)}</select></label>}<div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={locked || !chosen} onClick={() => command("publish")}>确认发布版本</button><button type="button" className={BUTTON} disabled={locked || selected.status !== "enabled"} onClick={() => command("disable")}>停用工具</button></div><p className="text-xs leading-5 text-slate-500">发布固定所选正式版本；调用开始时仍以服务端当时开放的绑定为准。这里不提供嵌入代码、跨域免鉴权或旧版展示模板。</p></div><div className="min-w-0 space-y-3"><h4 className="font-semibold">发放调用凭据</h4><label className="block text-sm">凭据名称<input value={keyName} disabled={locked} maxLength={200} onChange={(event) => setKeyName(event.target.value)} className={FIELD} /></label><label className="block text-sm">到期时间（可不填）<input type="datetime-local" value={expiry} disabled={locked} onChange={(event) => setExpiry(event.target.value)} className={FIELD} /></label><button type="button" className={BUTTON} disabled={locked || !keyName.trim() || selected.status !== "enabled" || Boolean(plainToken)} onClick={() => command("mint-key")}>发放调用凭据</button></div></div>
      {plainToken ? <div role="region" aria-label="一次性调用凭据" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><h4 className="font-semibold">调用凭据仅首次返回</h4><p className="text-sm leading-6">请妥善保管，不放入链接、日志或第三方网页代码。刷新后只能查看元数据或撤销，不能恢复明文。</p><input aria-label="一次性调用凭据明文" type={revealed ? "text" : "password"} value={plainToken} readOnly autoComplete="off" spellCheck={false} className={FIELD} /><div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} onClick={() => setRevealed(!revealed)}>{revealed ? "隐藏凭据" : "显示一次性凭据"}</button><button type="button" className={BUTTON} onClick={() => { void copy(plainToken); }}>复制调用凭据</button><button type="button" className={BUTTON} onClick={() => { if (window.confirm("清除后本页不能恢复这份明文；凭据仍然有效，撤销需单独操作。确定清除明文吗？")) { setPlainToken(null); setRevealed(false); } }}>清除凭据明文</button></div></div> : null}
      <section aria-label="凭据元数据" className="min-w-0 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">凭据元数据与撤销</h4><button type="button" className={BUTTON} disabled={locked || !validManagementCredential(credential)} onClick={() => startTransition(() => { void read("keys"); })}>刷新凭据清单</button></div>{keys ? <><p className="text-xs text-slate-500">本次读到 {keys.keys.length} 项{keys.truncated ? "，仅前 100 项；不能当作完整历史。" : "，不返回凭据明文或指纹。"}</p><p className="text-xs leading-5 text-slate-500">到期判断以上次读取时本机时间为准；实际调用仍由系统检查。</p>{keys.keys.length ? <ul className="min-w-0 space-y-2">{keys.keys.map((key) => <li key={key.keyId} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0 flex-1"><span className="break-words font-medium">{name(key.name, "未命名凭据")}</span><p className="mt-1 text-xs text-slate-500">{key.revokedAt ? "已撤销" : key.expiresAt && keysReadAt !== null && new Date(key.expiresAt).getTime() <= keysReadAt ? "已到期" : "未撤销"} · {key.expiresAt ? `到期时间 ${new Date(key.expiresAt).toLocaleString("zh-CN")}` : "未设置到期时间"}</p></div><button type="button" className={BUTTON + " shrink-0"} aria-label={`撤销${name(key.name, "未命名凭据")}`} disabled={locked || Boolean(key.revokedAt)} onClick={() => command("revoke-key", key.keyId)}>撤销凭据</button></li>)}</ul> : <p role="status">本次没有读到凭据，不能从这里恢复历史明文。</p>}</> : <p className="text-sm text-slate-600">凭据清单尚未核对或已经失效，请手动刷新；不按零凭据显示。</p>}</section>
      <PublicToolServerGuide tool={selected} />
      <ToolCall key={selected.toolId} tool={selected} onProtectionChange={(dirtyCall, lockedCall) => { callProtection.current = { dirty: dirtyCall, locked: lockedCall }; setCallLocked(lockedCall); }} />
    </section> : null}
    <ConfirmDialog open={attempt !== null && !attempt.unknown} onOpenChange={(open) => { if (!open && !working.current) { const current = active.current; if (current?.submitted) { const next = { ...current, unknown: true }; active.current = next; setAttempt(next); } else { active.current = null; setAttempt(null); } } }} title="确认本次工具管理操作？" description={attempt?.description ?? ""} confirmLabel="确认执行管理操作" pending={busy} tone="warning" onConfirm={() => startTransition(() => { void execute(); })} />
  </section>;
}

function ToolCall({ tool, onProtectionChange }: { tool: PublicToolView; onProtectionChange: (dirty: boolean, locked: boolean) => void }) {
  const instance = useId();
  const [credential, setCredential] = useState("");
  const [preview, setPreview] = useState<PublicToolView | null>(null);
  const [attempt, setAttempt] = useState<CallAttempt | null>(null), [receipt, setReceipt] = useState<PublicToolCallReceipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const live = useRef(false), epoch = useRef(0), working = useRef(false), active = useRef<CallAttempt | null>(null);
  const latestReceipt = useRef<PublicToolCallReceipt | null>(null), callbacks = useRef(onProtectionChange);
  const fields = (attempt?.preview ?? preview)?.publication?.inputContract.fields ?? [];
  const structured = useStructuredInputSession(fields, () => working.current || active.current !== null);
  const dirty = Boolean(credential || attempt || structured.pendingCount || Object.values(structured.values).some(Boolean));
  const locked = busy || attempt?.phase === "unknown" || attempt?.phase === "confirm";
  useProtectedPage(`public-tool-call:${instance}`, dirty);
  useLayoutEffect(() => { callbacks.current = onProtectionChange; });
  useLayoutEffect(() => { callbacks.current(dirty, locked); }, [dirty, locked]);
  useLayoutEffect(() => { live.current = true; epoch.current += 1; return () => { live.current = false; epoch.current += 1; active.current = null; callbacks.current(false, false); }; }, []);

  async function load() {
    if (!live.current || working.current || active.current || !validCallCredential(credential)) return;
    if ((Object.values(structured.values).some(Boolean) || structured.pendingCount) && !window.confirm("重新读取调用字段会清除本页尚未提交的调用填写，不会创建任务。确定继续吗？")) return;
    working.current = true; setBusy(true); setError(null); const stamp = ++epoch.current;
    try {
      const result = await readCallableTool(credential, tool.toolId);
      if (!live.current || stamp !== epoch.current) return;
      if (!result.ok) { setError(failure(result)); setPreview(null); return; }
      if (result.tool.status !== "enabled" || !result.tool.publication) { setError("当前工具没有已开放的发布绑定，不提供调用表单。"); setPreview(null); return; }
      working.current = false; structured.reset(); setPreview(result.tool); setReceipt(null); latestReceipt.current = null;
    } catch { if (live.current && stamp === epoch.current) { setPreview(null); setError("调用字段读取失败；不能用管理清单或默认填写替代调用授权。"); } }
    finally { if (live.current && stamp === epoch.current) { working.current = false; setBusy(false); } }
  }
  function prepare() {
    if (!live.current || working.current || active.current || !preview?.publication || preview.status !== "enabled") return;
    if (structured.firstPendingIndex() !== null) { setError("请先应用或取消结构化填写中的本地草稿。"); return; }
    const prepared = prepareRunLauncherInput(fields, structured.valuesRef.current, "{}");
    if (!prepared.input) { setError(prepared.error); return; }
    const requestId = newPublicToolRequestId();
    if (!requestId) { setError("本次请求暂时无法准备，尚未发送。填写仍保留，请重新尝试。"); return; }
    const input = PublicToolCallInput.safeParse({ requestId, input: prepared.input });
    if (!input.success || !validCallCredential(credential)) { setError("本次填写或调用凭据无法核对。"); return; }
    const content = JSON.stringify(input.data);
    if (content.includes(credential) || /\bpat_[a-f0-9]{64}\b/.test(content)) { setError("调用填写不能包含凭据，请移除后再确认。"); return; }
    const next: CallAttempt = { input: input.data, credential, preview, phase: "confirm", submitted: false };
    active.current = next; setAttempt(next); setError(null);
  }
  async function execute(readOnly: boolean) {
    const original = active.current;
    if (!live.current || working.current || !original) return;
    const request = { ...original, submitted: true };
    active.current = request; setAttempt(request);
    working.current = true; setBusy(true); setError(null); const stamp = epoch.current;
    try {
      const result = readOnly ? await readToolCall(request.credential, { toolId: tool.toolId, requestId: request.input.requestId }) : await submitToolCall(request.credential, tool.toolId, request.input);
      if (!live.current || stamp !== epoch.current || active.current !== request) return;
      if (!result.ok) {
        setError(failure(result));
        if (!readOnly && !original.submitted && ["unauthorized", "invalid"].includes(result.code)) { active.current = null; setAttempt(null); }
        else { const next = { ...request, phase: "unknown" as const }; active.current = next; setAttempt(next); }
        return;
      }
      const previous = latestReceipt.current;
      if (previous && (previous.publicationId !== result.call.publicationId || previous.version !== result.call.version)
        || request.preview.publication?.publicationId === result.call.publicationId && request.preview.publication.version !== result.call.version) throw new Error("原请求的发布关联变化");
      latestReceipt.current = result.call; setReceipt(result.call);
      const next: CallAttempt = { ...request, phase: ["unknown", "start_unknown"].includes(result.call.state) ? "unknown" : "received" };
      active.current = next; setAttempt(next);
    } catch { if (live.current && stamp === epoch.current && active.current === request) { const next = { ...request, phase: "unknown" as const }; active.current = next; setAttempt(next); setError("本次结果暂时未知，原请求和完整输入仍保留，不自动重发。上次已读回执不代表当前状态。"); } }
    finally { if (live.current && stamp === epoch.current) { working.current = false; setBusy(false); } }
  }
  function finish() {
    if (working.current || active.current?.phase !== "received" || !window.confirm("结束本页核对会清除原请求、填写和临时调用凭据，不取消已登记任务；之后调用属于另一请求。确定结束吗？")) return;
    epoch.current += 1; active.current = null; setAttempt(null); setReceipt(null); latestReceipt.current = null; setPreview(null); setCredential(""); structured.reset(); setError(null);
  }

  return <section aria-label="真实工具调用" className="space-y-3 border-t border-slate-200 pt-4"><h4 className="font-semibold">使用调用凭据真实运行</h4><p className="text-sm leading-6 text-slate-600">调用可能消耗执行与模型额度。收到回执不等于完成或交付；本页不自动轮询、不自动重发、不发送到第三方网站。</p><label className="block text-sm">调用凭据<input type="password" autoComplete="off" spellCheck={false} maxLength={68} value={credential} disabled={busy || attempt !== null} onChange={(event) => { epoch.current += 1; setCredential(event.target.value); setPreview(null); setReceipt(null); latestReceipt.current = null; setError(null); }} className={FIELD} /></label><button type="button" className={BUTTON} disabled={busy || attempt !== null || !validCallCredential(credential)} onClick={() => startTransition(() => { void load(); })}>核对调用字段</button>
    {busy ? <p role="status">正在核对原调用，请勿重复点击…</p> : null}{error ? <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-950">{error}</p> : null}
    {preview?.publication ? <form aria-label="工具调用填写" onSubmit={(event) => { event.preventDefault(); prepare(); }} className="space-y-3 rounded-xl bg-slate-50 p-4">
      <p className="text-sm">已读到版本 {preview.publication.version} 的字段；调用接口不能锁定这份预览，实际绑定以本次回执为准。</p>
      <p className="text-xs text-slate-500">全部填写合计受服务端输入容量限制；超限会明确拒绝，不自动截断正文。</p>
      {fields.map((field, index) => {
        const label = runLauncherFieldLabel(field, index);
        return field.type === "object" || field.type === "array" ? <div key={field.name} className="space-y-2">
          <details><summary className="text-sm">开发者原始数据输入</summary><label className="mt-2 block text-sm">{label}原始数据<textarea rows={5} disabled={busy || attempt !== null || structured.pendingCount > 0} value={structured.values[field.name] ?? ""} onChange={(event) => structured.update(field.name, event.target.value)} className={`${FIELD} font-mono`} /></label><p className="mt-1 text-xs text-slate-500">结构化草稿应用或取消后才能修改原始数据；全部输入仍按同一服务端契约校验。</p></details>
          <StructuredInputEditor field={field} label={label} value={structured.values[field.name] ?? ""} revision={structured.revisions[field.name] ?? 0} disabled={busy || attempt !== null} onApply={(text, revision) => structured.apply(field.name, text, revision)} onPendingChange={(owner, revision, pending) => structured.reportPending(field.name, owner, revision, pending)} />
        </div> : <label key={field.name} className="block text-sm">{label}{field.required ? "（必填）" : "（选填）"}{field.type === "boolean" ? <select disabled={busy || attempt !== null} value={structured.values[field.name] ?? ""} onChange={(event) => structured.update(field.name, event.target.value)} className={FIELD}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select> : field.type === "number" ? <input type="number" step="any" disabled={busy || attempt !== null} value={structured.values[field.name] ?? ""} onChange={(event) => structured.update(field.name, event.target.value)} className={FIELD} /> : <textarea rows={4} disabled={busy || attempt !== null} value={structured.values[field.name] ?? ""} onChange={(event) => structured.update(field.name, event.target.value)} className={FIELD} />}</label>;
      })}
      {fields.length === 0 ? <p className="text-sm">本版本未声明输入字段，将以空填写调用，不添加默认业务资料。</p> : null}
      {structured.draftError ? <p role="alert">{structured.draftError}</p> : null}<button type="submit" className={PRIMARY} disabled={busy || attempt !== null}>确认真实调用</button>
    </form> : null}
    {attempt ? <div role="region" aria-label="本次调用核对" className="space-y-3 rounded-xl border p-4"><p className="text-sm leading-6">{attempt.phase === "unknown" ? "原调用结果待核对，完整输入与请求保持不变。重新提交原调用是写操作，可能尝试启动；只读核对不启动。" : "本页保留同一次调用的请求和输入，手动读取回执不创建新任务。"}</p><div className="flex flex-wrap gap-2"><button type="button" className={BUTTON} disabled={busy || attempt.phase === "confirm"} onClick={() => startTransition(() => { void execute(true); })}>只读核对原调用结果</button>{attempt.phase === "unknown" ? <button type="button" className={BUTTON} disabled={busy} onClick={() => { const current = active.current; if (current) { const next = { ...current, phase: "confirm" as const }; active.current = next; setAttempt(next); } }}>核对并重试原调用</button> : null}<button type="button" className={BUTTON} disabled={busy || attempt.phase !== "received"} onClick={finish}>结束本页核对</button></div><details><summary className="text-sm">开发者原请求（不含调用凭据）</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(attempt.input, null, 2)}</pre></details></div> : null}
    {receipt && attempt?.phase === "unknown" ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">下面保留的是上次已读取的回执；当前状态仍待核对，不能把旧证据当成刚刚核对成功。</p> : null}
    {receipt ? <section aria-label="已读取调用回执" className="space-y-3 rounded-xl border border-indigo-200 p-4"><h5 className="font-semibold">{CALL_STATE[receipt.state]} · 实际版本 {receipt.version}</h5><p className="text-sm leading-6">请求已登记，不代表已经完成。成果仍需业务核对；系统没有确认已经对外发送或交付。</p>{attempt && receipt.publicationId !== attempt.preview.publication?.publicationId ? <p role="alert" className="text-sm text-amber-800">实际发布绑定不同于填写前的预览，请按本次回执核对，不把旧字段说明当作版本锁定。</p> : null}{receipt.resultAvailable ? <div aria-label="已保存工具成果"><StructuredRunValue value={receipt.result} maxEntries={20} /></div> : <p className="text-sm text-slate-600">当前回执没有可核对的成功成果，不用占位内容代替。</p>}<details><summary className="text-sm">开发者回执数据</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(receipt, null, 2)}</pre></details></section> : null}
    <ConfirmDialog open={attempt?.phase === "confirm"} onOpenChange={(open) => { if (!open && !working.current) { const current = active.current; if (current && !current.submitted) { active.current = null; setAttempt(null); } else if (current) { const next = { ...current, phase: "unknown" as const }; active.current = next; setAttempt(next); } } }} title="确认执行真实工具调用？" description="这会沿本次固定请求与完整输入调用工具，并可能消耗执行额度。实际发布绑定以服务端收到调用时为准；重试沿原请求，不代表只读刷新。" confirmLabel="确认执行真实调用" tone="warning" pending={busy} onConfirm={() => startTransition(() => { void execute(false); })} />
  </section>;
}
