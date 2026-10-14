"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ClipboardPen, LockKeyhole, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CapabilityNotice } from "@/components/ui/CapabilityNotice";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { notifyDraftState } from "@/lib/draft-state";
import { MCP_DESIGN_AUTHENTICATION, MCP_DESIGN_AUTOMATION, MCP_DESIGN_OPERATIONS, MCP_DESIGN_RISKS,
  checkMcpConnectionDesign, createMcpConnectionDesignDraft, mcpDesignCapabilityLabels, resemblesMcpAccessSecret,
  type McpConnectionDesignDraft as LocalDraft, type McpConnectionDesignIssue } from "./mcp-connection-design-draft";

const FIELD = "w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-100 disabled:bg-slate-100";
const FIELD_LABELS: Record<string, string> = {
  name: "连接名称", address: "服务地址", authentication: "认证方式设计", credentialReference: "服务端凭据名称引用",
  accountReference: "已有账号授权名称引用", headerName: "认证请求头名称", displayName: "员工看到的工具名称",
  behavior: "它实际会做什么", capabilityLabels: "待核验能力标签", operation: "读写类型设计", risk: "风险等级设计", automation: "运行策略设计",
};

export function McpConnectionDesignDraft() {
  const instance = useId();
  const [draft, setDraft] = useState(createMcpConnectionDesignDraft);
  const [checkpoint, setCheckpoint] = useState<LocalDraft | null>(null);
  const [issues, setIssues] = useState<McpConnectionDesignIssue[]>([]);
  const [focusProblem, setFocusProblem] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"clear" | "undo" | null>(null);
  const designRootRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const checkButtonRef = useRef<HTMLButtonElement | null>(null);
  const serialized = JSON.stringify(draft);
  const dirty = serialized !== JSON.stringify(createMcpConnectionDesignDraft());
  const changedSinceCheckpoint = checkpoint !== null && serialized !== JSON.stringify(checkpoint);
  const draftKey = "external-connection-design:" + instance;
  const statusId = instance + "-design-status";
  const errorId = (field: string) => instance + "-error-" + field;

  useLayoutEffect(() => { notifyDraftState({ agentId: draftKey, dirty }); }, [draftKey, dirty]);
  useLayoutEffect(() => () => notifyDraftState({ agentId: draftKey, dirty: false }), [draftKey]);
  useEffect(() => {
    if (!dirty) return;
    function protectPage(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", protectPage);
    return () => window.removeEventListener("beforeunload", protectPage);
  }, [dirty]);
  useLayoutEffect(() => {
    if (!focusProblem) return;
    const target = Array.from(designRootRef.current?.querySelectorAll<HTMLElement>("[data-connection-field]") ?? [])
      .find((element) => element.dataset.connectionField === focusProblem);
    if (!target?.isConnected) return;
    const disclosure = target.closest("details");
    if (disclosure) disclosure.open = true;
    target.focus();
  }, [focusProblem, issues]);

  function fieldAttributes(field: string) {
    const error = issues.some((issue) => issue.field === field);
    return { "data-connection-field": field,
      "aria-label": FIELD_LABELS[field], "aria-invalid": error || undefined, "aria-describedby": error ? errorId(field) : undefined };
  }
  function fieldError(field: string) {
    const issue = issues.find((item) => item.field === field);
    return issue ? <span id={errorId(field)} className="mt-1 block break-words text-xs leading-5 text-red-700">{issue.message}</span> : null;
  }
  function update<K extends keyof LocalDraft>(field: K, value: LocalDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setIssues([]); setFeedback(null); setFocusProblem(null);
  }
  function updateReference(field: "credentialReference" | "accountReference", value: string) {
    if (resemblesMcpAccessSecret(value)) {
      setIssues([{ field, message: "此填写疑似凭据值，本页未接收；请填写名称引用。" }]);
      setFocusProblem(field); setFeedback(null); return;
    }
    update(field, value);
  }
  function checkDraft() {
    const problems = checkMcpConnectionDesign(draft);
    setIssues(problems);
    setFocusProblem(problems[0]?.field ?? null);
    if (problems.length) { setFeedback(null); return; }
    setCheckpoint({ ...draft });
    setFeedback("当前启用方案的本页格式与设计约束检查完成，已建立本页检查点；尚未保存、连接、发现或授权。未启用的填写仅保留，未检查。名称引用是否存在、服务是否可用与能力是否属实均未核验。");
  }
  function requestReset(action: "clear" | "undo", trigger: HTMLElement) {
    returnFocusRef.current = trigger; setConfirmation(action);
  }
  function confirmReset() {
    if (confirmation === "clear") {
      setDraft(createMcpConnectionDesignDraft()); setCheckpoint(null); setFeedback("本页草稿已清空，真实连接目录未改变。");
    } else if (confirmation === "undo" && checkpoint) {
      setDraft({ ...checkpoint }); returnFocusRef.current = checkButtonRef.current;
      setFeedback("已恢复最近一次本页检查点，仍尚未保存；没有还原或修改服务器配置。");
    }
    setIssues([]); setFocusProblem(null); setConfirmation(null);
  }
  const capabilityLabels = mcpDesignCapabilityLabels(draft.capabilityLabels);
  const authenticationLabel = MCP_DESIGN_AUTHENTICATION.find((item) => item.value === draft.authentication)?.label ?? "尚未选择";
  const riskLabel = MCP_DESIGN_RISKS.find((item) => item.value === draft.risk)?.label ?? "待评估";
  const operationLabel = MCP_DESIGN_OPERATIONS.find((item) => item.value === draft.operation)?.label ?? "待说明";
  const automationLabel = MCP_DESIGN_AUTOMATION.find((item) => item.value === draft.automation)?.label ?? "待设计";

  return <section ref={designRootRef} aria-label="连接设计草稿" className="min-w-0 space-y-5">
    <CapabilityNotice mode="draft" title="连接设计 · 尚未保存">
      这里只编辑本页方案，不新增或修改真实连接。缺少连接管理、完整发现、业务边界保存、账号与版本授权、影响范围及环境白名单接口；不能把本页设计当作系统生效配置。
    </CapabilityNotice>
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{dirty ? "有未保存的本页填写" : "新连接设计，尚未保存"}</p>
        <p className="mt-1 text-xs text-slate-500">{checkpoint ? changedSinceCheckpoint ? "检查点之后有新修改，当前填写需要重新检查。" : "当前内容与本页检查点一致，不代表服务器已保存。" : "尚未建立本页检查点。"}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={!changedSinceCheckpoint} onClick={(event) => requestReset("undo", event.currentTarget)}><RotateCcw aria-hidden="true" className="size-4" />撤销到本页检查点</Button>
        <Button type="button" variant="ghost" onClick={(event) => requestReset("clear", event.currentTarget)}><Trash2 aria-hidden="true" className="size-4" />清空草稿</Button>
      </div>
    </div>
    {issues.length ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">本页检查未完成，请核对标记项；原填写和此前检查点均保留。</div> : null}
    {feedback ? <p id={statusId} role="status" className="break-words rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm leading-6 text-indigo-800">{feedback}</p> : null}
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <Card className="min-w-0"><CardHeader><CardTitle>服务连接方案</CardTitle><CardDescription>填写服务名称与地址；本地检查不会请求该地址。</CardDescription></CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">连接名称<input {...fieldAttributes("name")} className={FIELD} value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="最多 200 字" />{fieldError("name")}</label>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">服务地址<input {...fieldAttributes("address")} className={FIELD} value={draft.address} onChange={(event) => update("address", event.target.value)} placeholder="填写完整网页服务地址" autoComplete="off" spellCheck={false} />{fieldError("address")}</label>
            <p className="text-xs leading-5 text-slate-500">本页设计保护仅接受网页地址，不接受账号密码、任何查询参数或片段，避免误填凭据；这不是服务端全部协议的限制声明。请勿把密钥写入地址。</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-sm font-semibold text-slate-700">传输方式：流式网页连接</p><p className="mt-1 text-xs leading-5 text-slate-500">服务端已有此传输方式，本页设计尚未连接；不提供本地进程或其他传输切换。</p></div>
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">认证方式设计<select {...fieldAttributes("authentication")} className={FIELD} value={draft.authentication} onChange={(event) => {
              if (event.target.value === "") { update("authentication", ""); return; }
              const chosen = MCP_DESIGN_AUTHENTICATION.find((item) => item.value === event.target.value);
              if (chosen) update("authentication", chosen.value);
            }}><option value="">请选择，不默认免认证</option>{MCP_DESIGN_AUTHENTICATION.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{fieldError("authentication")}</label>
            {draft.authentication === "credential" ? <div className="min-w-0 space-y-3">
              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">服务端凭据名称引用<input {...fieldAttributes("credentialReference")} className={FIELD} value={draft.credentialReference} onChange={(event) => updateReference("credentialReference", event.target.value)} autoComplete="off" placeholder="仅填写名称，不填写访问密钥" />{fieldError("credentialReference")}</label>
              <details className="min-w-0 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">认证请求设置（维护人员）</summary>
                <label className="mt-3 block space-y-1.5 text-sm text-slate-700">认证请求头名称<input {...fieldAttributes("headerName")} className={FIELD} value={draft.headerName} onChange={(event) => update("headerName", event.target.value)} placeholder="由服务维护人员核对" autoComplete="off" />{fieldError("headerName")}</label>
                <p className="mt-2 text-xs leading-5 text-slate-500">只设计请求头的名称，不填写请求头值。实际凭据保管与替换须由受保护的后端能力处理。</p>
              </details>
            </div> : draft.authentication === "account" ? <div className="space-y-3">
              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">已有账号授权名称引用<input {...fieldAttributes("accountReference")} className={FIELD} value={draft.accountReference} onChange={(event) => updateReference("accountReference", event.target.value)} autoComplete="off" placeholder="填写已有授权的名称，不填写授权值" />{fieldError("accountReference")}</label>
              <p className="text-xs leading-5 text-slate-500">当前未读取账号授权目录，名称存在与有效性均未核验；没有提供示例账号或第三方登录链接。</p>
            </div> : null}
            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">实际访问密钥<input type="password" disabled value="" readOnly className={FIELD} placeholder="入口待接入，本页不收集密钥" autoComplete="off" /></label>
            <p className="text-xs leading-5 text-slate-500">切换认证方案保留已填写的名称引用；不会重新授权、清除服务端凭据或改变已有连接。</p>
          </CardContent>
        </Card>
        <Card className="min-w-0"><CardHeader><CardTitle>工具业务边界设计</CardTitle><CardDescription>可选的业务说明和运行方案，不核验能力，不授予权限。</CardDescription></CardHeader>
          <CardContent className="min-w-0 space-y-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input type="checkbox" checked={draft.boundaryEnabled} onChange={(event) => update("boundaryEnabled", event.target.checked)} />填写工具业务边界方案</label>
            <details hidden={!draft.boundaryEnabled} className="min-w-0 rounded-xl border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">展开业务边界填写</summary>
              <div className="min-w-0 space-y-4 pt-4">
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">员工看到的工具名称<input {...fieldAttributes("displayName")} className={FIELD} value={draft.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="最多 200 字" />{fieldError("displayName")}</label>
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">它实际会做什么<textarea {...fieldAttributes("behavior")} rows={4} className={FIELD} value={draft.behavior} onChange={(event) => update("behavior", event.target.value)} placeholder="说明数据来源、写入对象与成功回执，最多 4000 字" />{fieldError("behavior")}</label>
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">待核验能力标签<textarea {...fieldAttributes("capabilityLabels")} rows={3} className={FIELD} value={draft.capabilityLabels} onChange={(event) => update("capabilityLabels", event.target.value)} placeholder="每行一个待核验标签，最多 50 项，每项不超过 200 字" />{fieldError("capabilityLabels")}</label>
                <p className="text-xs leading-5 text-slate-500">这些标签仅代表你希望核对的能力，不会标为已核验，也不进入真实工具目录。</p>
                <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
                  <label className="block space-y-1.5 text-sm font-semibold text-slate-700">读写类型设计<select {...fieldAttributes("operation")} className={FIELD} value={draft.operation} onChange={(event) => {
                    if (event.target.value === "") { update("operation", ""); return; }
                    const chosen = MCP_DESIGN_OPERATIONS.find((item) => item.value === event.target.value); if (chosen) update("operation", chosen.value);
                  }}><option value="">请选择</option>{MCP_DESIGN_OPERATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{fieldError("operation")}</label>
                  <label className="block space-y-1.5 text-sm font-semibold text-slate-700">风险等级设计<select {...fieldAttributes("risk")} className={FIELD} value={draft.risk} onChange={(event) => {
                    if (event.target.value === "") { update("risk", ""); return; }
                    const chosen = MCP_DESIGN_RISKS.find((item) => item.value === event.target.value);
                    if (!chosen) return;
                    if (chosen.value === "high" && draft.automation === "automatic_allowed") {
                      setDraft((current) => ({ ...current, risk: "high", automation: "approval_required" }));
                      setIssues([]); setFocusProblem(null); setFeedback("高风险方案不能设为自动调用，本页已改为人工确认；尚未保存或生效。");
                    } else update("risk", chosen.value);
                  }}><option value="">请选择</option>{MCP_DESIGN_RISKS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{fieldError("risk")}</label>
                </div>
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">运行策略设计<select {...fieldAttributes("automation")} className={FIELD} value={draft.automation} onChange={(event) => {
                  if (event.target.value === "") { update("automation", ""); return; }
                  const chosen = MCP_DESIGN_AUTOMATION.find((item) => item.value === event.target.value); if (chosen) update("automation", chosen.value);
                }}><option value="">请选择</option>{MCP_DESIGN_AUTOMATION.map((item) => <option key={item.value} value={item.value} disabled={item.value === "automatic_allowed" && draft.risk === "high"}>{item.label}</option>)}</select>{fieldError("automation")}</label>
                <p className="text-xs leading-5 text-slate-500">高风险不能设计为自动调用；所有风险和读写声明仍待真实核验。选择人工确认或停用不会立即改变已有助手和运行。</p>
              </div>
            </details>
            {!draft.boundaryEnabled ? <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">暂不设计业务边界。此前填写若有则保留，不自动删除或授权。</p> : null}
          </CardContent>
        </Card>
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap gap-2"><button ref={checkButtonRef} type="button" className={buttonVariants({ variant: "secondary" })} onClick={checkDraft}><Check aria-hidden="true" className="size-4" />检查草稿</button>
            <Button type="button" disabled>保存连接（待接入）</Button><Button type="button" disabled>连接测试（待接入）</Button><Button type="button" disabled>发现工具（待接入）</Button><Button type="button" disabled>账号授权（待接入）</Button></div>
          <p className="text-xs leading-5 text-slate-500">保存、连接测试、发现与授权各是独立结果；本页均未执行。真实登记与检查请使用上方“登记与检查”分区。</p>
          <p className="text-xs leading-5 text-slate-500">仅当前页面临时保留，不写入浏览器存储。检查不会清除未保存状态；关闭或刷新页面后，本页填写与检查点无法恢复。</p>
        </div>
      </div>
      <aside aria-label="本页设计摘要" className="min-w-0 space-y-4 xl:sticky xl:top-5">
        <Card className="min-w-0"><CardHeader><CardTitle className="flex items-center gap-2"><ClipboardPen aria-hidden="true" className="size-4 shrink-0" />设计摘要</CardTitle><CardDescription>仅来自当前本页填写，不是已连接记录。</CardDescription></CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <h3 className="break-words text-lg font-bold text-slate-900">{draft.name || "尚未命名的连接设计"}</h3>
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900"><LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><p className="min-w-0">尚未保存、连接或授权，不提供可点击服务链接，也不展示访问凭据。</p></div>
            <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm text-slate-600">
              <dt>传输方案</dt><dd className="break-words">流式网页连接</dd><dt>认证方案</dt><dd className="break-words">{authenticationLabel}</dd>
            </dl>
            {draft.boundaryEnabled ? <div className="min-w-0 space-y-3 border-t border-slate-100 pt-3">
              <h4 className="break-words text-sm font-semibold text-slate-800">{draft.displayName || "尚未填写业务名称"}</h4>
              <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{draft.behavior || "实际行为尚待说明。"}</p>
              <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs text-slate-600"><dt>读写设计</dt><dd className="break-words">{operationLabel}</dd><dt>风险设计</dt><dd className="break-words">{riskLabel}</dd><dt>运行设计</dt><dd className="break-words">{automationLabel}</dd></dl>
              <p className="flex items-center gap-2 text-xs font-semibold text-amber-800"><ShieldCheck aria-hidden="true" className="size-4 shrink-0" />能力标签均待核验</p>
              {capabilityLabels.length ? <ul className="min-w-0 space-y-1">{capabilityLabels.map((label, index) => <li key={index} className="break-words rounded-lg border border-amber-100 bg-amber-50 px-2 py-1 text-xs text-amber-900">{label}</li>)}</ul> : <p className="text-xs text-slate-500">尚未填写待核验标签，没有生成默认能力。</p>}
            </div> : null}
          </CardContent>
        </Card>
        <CapabilityNotice mode="draft" title="真实影响与授权尚未读取">不提供虚构助手、任务、影响数量、已核验工具或账号列表。连接、版本与环境授权必须由后端按实际归属核对。</CapabilityNotice>
      </aside>
    </div>
    <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} tone="warning" returnFocusRef={returnFocusRef}
      title={confirmation === "undo" ? "确认撤销本页修改？" : "确认清空连接设计？"}
      description={confirmation === "undo" ? "将恢复最近一次本页检查通过时的内容，丢弃之后的修改；仍尚未保存，不会还原服务器连接。"
        : "将清空「" + (draft.name || "未命名连接设计") + "」的本页填写和检查点，不删除、停用或更改真实连接目录。"}
      confirmLabel={confirmation === "undo" ? "恢复本页检查点" : "清空本页草稿"} onConfirm={confirmReset} />
  </section>;
}
