import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  GitBranch,
  ListChecks,
  MessageSquareText,
  PauseCircle,
  Route,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ApprovalPanel } from "@/features/runs/ApprovalPanel";
import { presentBusinessOutput } from "@/features/runs/present-business-output";
import { RunStatusBadge } from "@/features/runs/RunList";
import { TraceTimeline } from "@/features/runs/TraceTimeline";
import { WaitEventPanel } from "@/features/runs/WaitEventPanel";
import { CancelRunButton } from "@/features/runs/CancelRunButton";
import { RetryRunButton } from "@/features/runs/RetryRunButton";
import { CopyResultButton } from "@/features/runs/CopyResultButton";
import { ResumeRunStartButton } from "@/features/runs/ResumeRunStartButton";
import { RunFeedbackPanel } from "@/features/runs/RunFeedbackPanel";
import { runValueLabel, StructuredRunValue } from "@/features/runs/StructuredRunValue";
import type { RunStatus } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getPendingWait, getRunView, listApprovals, listChildRuns, listRunSteps } from "@/server/queries/runs";
import { listRecentTrace } from "@/server/queries/trace";
import { getRunFeedback } from "@/server/queries/run-feedback";
import { redactSensitiveData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { withSafeQueryError } from "@/server/security/query-error";

const LIVE_STATUSES: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting_approval", "waiting_event"]);

const RUN_GUIDANCE: Record<RunStatus, { eyebrow: string; title: string; description: string; icon: LucideIcon; tone: "indigo" | "amber" | "emerald" | "red" | "slate" }> = {
  queued: {
    eyebrow: "运行已创建",
    title: "正在等待执行",
    description: "系统已经固定这次运行的输入与版本；开始执行后，步骤和轨迹会在本页自动更新。",
    icon: Clock3,
    tone: "indigo",
  },
  running: {
    eyebrow: "正在处理",
    title: "助手正在执行任务",
    description: "已完成的步骤会持续保存。你可以留在此页查看进展，也可以稍后从运行记录回来。",
    icon: Activity,
    tone: "indigo",
  },
  waiting_approval: {
    eyebrow: "需要人工决定",
    title: "确认后才能继续",
    description: "当前进度已经保存。请先核对下方内容；批准后从暂停处继续，拒绝后安全结束本次运行。",
    icon: ShieldCheck,
    tone: "amber",
  },
  waiting_event: {
    eyebrow: "等待补充信息",
    title: "收到所需内容后继续",
    description: "当前进度已经保存。提交下方要求的内容后，系统会从暂停位置继续，不重复已完成步骤。",
    icon: PauseCircle,
    tone: "amber",
  },
  completed: {
    eyebrow: "运行已完成",
    title: "结果与执行证据已保存",
    description: "先核对最终结果并留下反馈；输入、步骤、轨迹和人工决定继续保留，便于后续追溯。",
    icon: CheckCircle2,
    tone: "emerald",
  },
  failed: {
    eyebrow: "运行未完成",
    title: "先核对失败原因，再决定是否重试",
    description: "已完成的步骤和执行证据仍然保留。再次运行会创建新记录，不会覆盖这次失败记录。",
    icon: CircleAlert,
    tone: "red",
  },
  cancelled: {
    eyebrow: "运行已取消",
    title: "本次运行已经安全停止",
    description: "停止前完成的步骤与执行证据仍然保留；如需继续，请按原输入创建一条新运行。",
    icon: XCircle,
    tone: "slate",
  },
};

const RUN_GUIDANCE_TONE = {
  indigo: { shell: "border-indigo-200 bg-indigo-50/70", icon: "bg-indigo-100 text-indigo-700", eyebrow: "text-indigo-700", link: "bg-indigo-600 hover:bg-indigo-700" },
  amber: { shell: "border-amber-200 bg-amber-50/80", icon: "bg-amber-100 text-amber-800", eyebrow: "text-amber-700", link: "bg-amber-800 hover:bg-amber-900" },
  emerald: { shell: "border-emerald-200 bg-emerald-50/70", icon: "bg-emerald-100 text-emerald-700", eyebrow: "text-emerald-700", link: "bg-emerald-700 hover:bg-emerald-800" },
  red: { shell: "border-red-200 bg-red-50/70", icon: "bg-red-100 text-red-700", eyebrow: "text-red-700", link: "bg-red-700 hover:bg-red-800" },
  slate: { shell: "border-slate-200 bg-slate-50", icon: "bg-slate-200 text-slate-600", eyebrow: "text-slate-600", link: "bg-slate-700 hover:bg-slate-800" },
} as const;

const STEP_STATUS_LABEL: Record<string, string> = {
  pending: "待执行",
  running: "运行中",
  succeeded: "已完成",
  failed: "失败",
};

const STEP_STATUS_STYLES: Record<string, string> = {
  pending: "bg-gray-100 text-gray-600",
  running: "bg-blue-50 text-blue-700",
  succeeded: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return "尚未开始";
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const duration = Math.max(0, end - new Date(startedAt).getTime());
  if (duration < 60_000) return `${Math.max(1, Math.round(duration / 1_000))} 秒`;
  if (duration < 3_600_000) return `${Math.round(duration / 60_000)} 分钟`;
  const hours = Math.floor(duration / 3_600_000);
  const minutes = Math.round((duration % 3_600_000) / 60_000);
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "手动运行",
  schedule: "由定时任务发起",
  agent_call: "由其他助手调用",
  handoff: "由其他助手交接",
  evaluation: "由自动验收发起",
};

function readResultPath(result: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, result);
}

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}

function fallbackResultLabel(key: string, stepTitleByNode: ReadonlyMap<string, string | null>): string {
  return stepTitleByNode.get(key) ?? (/\p{Script=Han}/u.test(key) ? key : "步骤结果");
}

export async function RunDetail({ runId, backHref = "/runs" }: { runId: string; backHref?: string }) {
  const run = await withSafeQueryError(() => getRunView(runId, DEMO_WORKSPACE_ID), "run-detail");
  if (!run) notFound();
  const [steps, approvals, trace, pendingWait, childRuns, feedback] = await withSafeQueryError(() => Promise.all([
    listRunSteps(runId, DEMO_WORKSPACE_ID),
    listApprovals(runId, DEMO_WORKSPACE_ID),
    listRecentTrace(runId, DEMO_WORKSPACE_ID),
    getPendingWait(runId, DEMO_WORKSPACE_ID),
    listChildRuns(runId, DEMO_WORKSPACE_ID),
    getRunFeedback(runId, DEMO_WORKSPACE_ID),
  ]), "run-detail-related");
  const live = LIVE_STATUSES.has(run.status);
  // 待确认的置顶，已决定的按时间在后
  const pendingApprovals = live ? approvals.filter((approval) => approval.status === "pending") : [];
  const decidedApprovals = approvals.filter((approval) => approval.status !== "pending");
  const recoverableApprovalId = run.status === "waiting_approval" && pendingApprovals.length === 0
    ? decidedApprovals.at(-1)?.id ?? null
    : null;
  const stepTitleByNode = new Map(steps.map((step) => [step.nodeId, step.nodeTitle]));
  const redactedInput = redactSensitiveData(run.input) as Record<string, unknown>;
  const contractedInputs = run.inputContract.fields
    .filter((field) => Object.prototype.hasOwnProperty.call(run.input, field.name))
    .map((field, index) => ({ name: field.name, label: field.label ?? `运行输入 ${index + 1}`, value: redactedInput[field.name] }));
  const inputs = contractedInputs.length > 0
    ? contractedInputs
    : Object.entries(redactedInput).map(([name, value], index) => ({ name, label: runValueLabel(name, index), value }));
  const resultRecord = run.result && typeof run.result === "object" && !Array.isArray(run.result)
    ? run.result as Record<string, unknown>
    : {};
  const redactedResult = redactSensitiveData(resultRecord) as Record<string, unknown>;
  const contractedOutputs = run.outputContract.fields
    .map((field, index) => ({ key: field.path, label: field.label ?? `交付内容 ${index + 1}`, output: readResultPath(redactedResult, field.path) }))
    .filter((field) => field.output !== undefined);
  const outputs = contractedOutputs.length > 0
    ? contractedOutputs
    : Object.entries(redactedResult).map(([key, output], index) => {
      const label = fallbackResultLabel(key, stepTitleByNode);
      return { key, label: label === "步骤结果" ? `步骤结果 ${index + 1}` : label, output };
    });
  const copyText = contractedOutputs.length > 0
    ? contractedOutputs.map((field) => `${field.label}\n${typeof field.output === "string" ? presentBusinessOutput(field.output).text : displayValue(field.output)}`).join("\n\n")
    : undefined;
  const completedSteps = steps.filter((step) => step.status === "succeeded").length;
  const guidance = RUN_GUIDANCE[run.status];
  const guidanceTone = RUN_GUIDANCE_TONE[guidance.tone];
  const GuidanceIcon = guidance.icon;
  const navigation = [
    run.result ? { href: "#result", label: "最终结果", icon: CheckCircle2 } : null,
    { href: "#input", label: "运行输入", icon: MessageSquareText },
    steps.length > 0 ? { href: "#steps", label: "执行步骤", icon: ListChecks } : null,
    { href: "#trace", label: "执行轨迹", icon: Route },
    approvals.length > 0 ? { href: "#approvals", label: "确认记录", icon: GitBranch } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <main className="page-shell min-h-screen">
      <Link href={backHref} className="flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-indigo-700">
        <ArrowLeft className="size-4" />
        {backHref === "/runs" ? "返回运行记录" : "返回筛选结果"}
      </Link>
      <header className="content-card overflow-hidden p-0 sm:p-0">
        <div className="flex flex-col gap-5 border-b border-slate-100 bg-gradient-to-br from-white via-white to-indigo-50/70 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">运行详情</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-200">
                <Activity className="size-5" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-950">{run.agentName}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <RunStatusBadge status={run.status} />
                  <span>{SOURCE_LABEL[run.sourceType] ?? "运行任务"}</span>
                  <span aria-hidden="true">·</span>
                  <span>{run.version === null ? "运行版本信息不可用" : `运行版本：版本 ${run.version}`}</span>
                </div>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-500">
              {run.startedAt ? `开始于 ${formatDateTime(run.startedAt)}` : "尚未开始"}
              {run.finishedAt ? `，结束于 ${formatDateTime(run.finishedAt)}` : ""}
            </p>
            {run.agentArchived ? <p className="mt-1 text-sm text-amber-700">这个助手已停用，历史运行仍保留。</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:max-w-[440px] lg:justify-end">
            {!run.agentArchived ? (
              <Link href={`/agents/${run.agentId}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700">
                <Bot className="size-4" />查看助手
              </Link>
            ) : null}
            {run.parentRunId ? (
              <Link aria-label="查看上级运行" href={`/runs/${run.parentRunId}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700">
                <GitBranch className="size-4" />上级运行
              </Link>
            ) : null}
            <Link href={`/harness?run=${run.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"><ShieldCheck className="size-4" />运行诊断</Link>
            <a aria-label="下载运行报告" href={`/api/runs/${runId}/export`} download className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700">
              <Download className="size-4" />下载报告
            </a>
            {live ? <CancelRunButton runId={runId} cancelsChain={["agent_call", "handoff"].includes(run.sourceType)} /> : null}
            {run.startupRecoverable ? <ResumeRunStartButton runId={runId} /> : null}
            {!live && !run.agentArchived ? <RetryRunButton runId={runId} /> : null}
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
          {[
            { label: "运行耗时", value: formatDuration(run.startedAt, run.finishedAt), icon: Clock3 },
            { label: "完成步骤", value: steps.length > 0 ? `${completedSteps} / ${steps.length}` : "暂无步骤", icon: ListChecks },
            { label: "确认事项", value: approvals.length > 0 ? `${approvals.length} 项` : "无需确认", icon: CheckCircle2 },
            { label: "协作任务", value: childRuns.length > 0 ? `${childRuns.length} 个` : "无", icon: GitBranch },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-center gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500"><Icon className="size-4" /></span>
              <div className="min-w-0"><p className="text-xs text-slate-400">{label}</p><p className="mt-0.5 truncate text-sm font-semibold text-slate-800">{value}</p></div>
            </div>
          ))}
        </div>
      </header>

      <section role={live ? "status" : undefined} aria-live={live ? "polite" : undefined} className={`flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between ${guidanceTone.shell}`}>
        <div className="flex min-w-0 items-start gap-3">
          <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${guidanceTone.icon}`}><GuidanceIcon aria-hidden="true" className="size-5" /></span>
          <div>
            <p className={`text-xs font-semibold ${guidanceTone.eyebrow}`}>{guidance.eyebrow}</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{guidance.title}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{guidance.description}</p>
          </div>
        </div>
        {run.status === "completed" && run.result ? (
          <a href="#result" className={`inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white ${guidanceTone.link}`}>查看最终结果</a>
        ) : run.status === "failed" && run.error ? (
          <a href="#run-failure" className={`inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white ${guidanceTone.link}`}>查看失败原因</a>
        ) : run.status === "waiting_approval" ? (
          <a href="#approval-title" className={`inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white ${guidanceTone.link}`}>处理确认事项</a>
        ) : null}
      </section>

      {run.status === "failed" && run.error ? (
        <div id="run-failure" role="alert" className="scroll-mt-32 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">失败原因</p>
          <p className="mt-1 leading-6">{redactSensitiveText(run.error)}</p>
        </div>
      ) : null}

      {run.status === "cancelled" && run.error ? (
        <div role="status" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p className="font-semibold">停止原因</p>
          <p className="mt-1 leading-6">{redactSensitiveText(run.error)}</p>
        </div>
      ) : null}

      {pendingApprovals.map((approval) => (
        <ApprovalPanel key={approval.id} runId={runId} approval={approval} />
      ))}

      {run.status === "waiting_event" && pendingWait ? (
        <WaitEventPanel
          runId={runId}
          eventKey={pendingWait.eventKey}
          title={pendingWait.title}
          submissionToken={pendingWait.submissionToken}
          payloadSchema={pendingWait.payloadSchema}
        />
      ) : null}

      <nav aria-label="运行详情区块" className="sticky top-16 z-20 -mx-1 flex gap-1 overflow-x-auto rounded-xl border border-slate-200/90 bg-white/95 p-1.5 shadow-sm backdrop-blur">
        {navigation.map(({ href, label, icon: Icon }) => (
          <a key={href} href={href} className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700">
            <Icon className="size-4" />{label}
          </a>
        ))}
      </nav>

      {childRuns.length > 0 ? (
        <section className="content-card flex flex-col gap-2">
          <h2 className="text-sm font-semibold">协作子任务</h2>
          <ul className="divide-y divide-gray-100">
            {childRuns.map((child) => (
              <li key={child.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <Link href={`/runs/${child.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                  {child.agentName}
                </Link>
                <span className="flex items-center gap-2">
                  {child.version === null ? null : <span className="text-xs text-gray-500">版本 {child.version}</span>}
                  <span className="text-xs text-gray-500">{child.sourceType === "handoff" ? "助手交接" : "助手协作"}</span>
                  <RunStatusBadge status={child.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {run.result ? (
        <section id="result" className="content-card scroll-mt-32 flex flex-col gap-3 border-emerald-200/80">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">最终结果</h2>
            <CopyResultButton result={redactedResult} text={copyText} />
          </div>
          {outputs.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {outputs.map(({ key, label, output }) => (
                <li key={key} className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-gray-700">
                    {label}
                  </p>
                  <StructuredRunValue value={typeof output === "string" ? presentBusinessOutput(output).text : output} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">这次运行没有产出内容。</p>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-sm text-gray-500">查看结果数据（开发者数据）</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
              {JSON.stringify(redactedResult, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}

      {run.status === "completed" ? (
        <RunFeedbackPanel key={`${feedback?.id ?? "new"}:${feedback?.updatedAt ?? ""}:${feedback?.evaluationCaseId ?? ""}`} runId={runId} agentId={run.agentId} agentArchived={run.agentArchived} initialFeedback={feedback} />
      ) : null}

      <section id="input" className="content-card scroll-mt-32 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">运行输入</h2>
        {inputs.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {inputs.map((field) => (
              <li key={field.name} className="flex flex-col gap-1">
                <p className="text-sm font-medium text-gray-700">{field.label}</p>
                <StructuredRunValue value={field.value} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">本次没有填写运行输入。</p>
        )}
        {inputs.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-sm text-gray-500">查看输入数据（开发者数据）</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">{JSON.stringify(redactedInput, null, 2)}</pre>
          </details>
        ) : null}
      </section>

      {steps.length > 0 ? (
        <section id="steps" className="content-card scroll-mt-32 flex flex-col gap-3">
          <h2 className="text-sm font-semibold">执行步骤</h2>
          <ul className="flex flex-col divide-y divide-gray-100">
            {steps.map((step) => (
              <li key={step.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="text-sm text-gray-800">{step.nodeTitle ?? "未命名步骤"}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STEP_STATUS_STYLES[step.status] ?? "bg-gray-100 text-gray-600"}`}>
                  {STEP_STATUS_LABEL[step.status] ?? "待执行"}
                </span>
                {step.output ? (
                  <details className="w-full min-w-0">
                    <summary className="cursor-pointer text-sm text-gray-500">查看步骤数据（开发者数据）</summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
                      {JSON.stringify(redactSensitiveData(step.output), null, 2)}
                    </pre>
                  </details>
                ) : null}
                {step.error ? (
                  <p role="alert" className="w-full whitespace-pre-wrap break-words text-sm text-red-700">
                    {redactSensitiveText(step.error)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section id="trace" className="content-card scroll-mt-32 flex flex-col gap-3">
        <h2 className="text-sm font-semibold">执行轨迹</h2>
        {live ? (
          <p className="text-xs text-gray-400">页面会自动更新最新进展</p>
        ) : null}
        <TraceTimeline runId={runId} initialEvents={trace} live={live} />
      </section>

      {decidedApprovals.length > 0 ? (
        <section id="approvals" className="scroll-mt-32 flex flex-col gap-2">
          {/* 普通区块标签：面板自身已带「已确认/未获确认」标题，避免标题嵌套重复 */}
          <p className="text-sm font-semibold">确认记录</p>
          {decidedApprovals.map((approval) => (
            <ApprovalPanel
              key={approval.id}
              runId={runId}
              approval={approval}
              recoverable={approval.id === recoverableApprovalId}
            />
          ))}
        </section>
      ) : null}
    </main>
  );
}
