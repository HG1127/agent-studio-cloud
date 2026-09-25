import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/features/runs/ApprovalPanel";
import { RunStatusBadge } from "@/features/runs/RunList";
import { TraceTimeline } from "@/features/runs/TraceTimeline";
import { WaitEventPanel } from "@/features/runs/WaitEventPanel";
import { CancelRunButton } from "@/features/runs/CancelRunButton";
import { RetryRunButton } from "@/features/runs/RetryRunButton";
import { CopyResultButton } from "@/features/runs/CopyResultButton";
import type { RunStatus } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getPendingWait, getRunView, listApprovals, listChildRuns, listRunSteps } from "@/server/queries/runs";
import { listRecentTrace } from "@/server/queries/trace";

const LIVE_STATUSES: ReadonlySet<RunStatus> = new Set(["queued", "running", "waiting_approval", "waiting_event"]);

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

export async function RunDetail({ runId }: { runId: string }) {
  const run = await getRunView(runId, DEMO_WORKSPACE_ID);
  if (!run) notFound();
  const [steps, approvals, trace, pendingWait, childRuns] = await Promise.all([
    listRunSteps(runId, DEMO_WORKSPACE_ID),
    listApprovals(runId, DEMO_WORKSPACE_ID),
    listRecentTrace(runId, DEMO_WORKSPACE_ID),
    getPendingWait(runId, DEMO_WORKSPACE_ID),
    listChildRuns(runId, DEMO_WORKSPACE_ID),
  ]);
  const live = LIVE_STATUSES.has(run.status);
  // 待确认的置顶，已决定的按时间在后
  const pendingApprovals = live ? approvals.filter((approval) => approval.status === "pending") : [];
  const decidedApprovals = approvals.filter((approval) => approval.status !== "pending");
  const outputs = Object.entries(run.result ?? {});
  const stepTitleByNode = new Map(steps.map((step) => [step.nodeId, step.nodeTitle]));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
      <Link href="/runs" className="w-fit text-sm text-gray-500 hover:text-gray-700">
        ← 返回运行记录
      </Link>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{run.agentName}</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="text-sm text-gray-500">
          {run.startedAt ? `开始于 ${formatDateTime(run.startedAt)}` : "尚未开始"}
          {run.finishedAt ? ` · 结束于 ${formatDateTime(run.finishedAt)}` : ""}
        </p>
        {run.agentArchived ? (
          <p className="text-sm text-gray-500">这个助手已停用，历史运行仍保留。</p>
        ) : (
          <Link href={`/agents/${run.agentId}`} className="w-fit text-sm text-gray-500 hover:text-gray-700">
            查看这个助手
          </Link>
        )}
        {run.parentRunId ? (
          <Link href={`/runs/${run.parentRunId}`} className="w-fit text-sm text-blue-700 hover:underline">
            查看上级运行
          </Link>
        ) : null}
        <a
          href={`/api/runs/${runId}/export`}
          download
          className="w-fit rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-500"
        >
          下载运行报告
        </a>
        {live ? <CancelRunButton runId={runId} cancelsChain={["agent_call", "handoff"].includes(run.sourceType)} /> : null}
        {!live && !run.agentArchived ? <RetryRunButton runId={runId} /> : null}
      </header>

      {run.status === "failed" && run.error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p>{run.error}</p>
        </div>
      ) : null}

      {pendingApprovals.map((approval) => (
        <ApprovalPanel key={approval.id} runId={runId} approval={approval} />
      ))}

      {run.status === "waiting_event" && pendingWait ? (
        <WaitEventPanel runId={runId} eventKey={pendingWait.eventKey} title={pendingWait.title} payloadSchema={pendingWait.payloadSchema} />
      ) : null}

      {childRuns.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold">协作子任务</h2>
          <ul className="divide-y divide-gray-100">
            {childRuns.map((child) => (
              <li key={child.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <Link href={`/runs/${child.id}`} className="text-sm font-medium text-blue-700 hover:underline">
                  {child.agentName}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{child.sourceType === "handoff" ? "助手交接" : "助手协作"}</span>
                  <RunStatusBadge status={child.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">运行输入</h2>
        <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">
          {JSON.stringify(run.input, null, 2)}
        </pre>
      </section>

      {run.result ? (
        <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">最终结果</h2>
            <CopyResultButton result={run.result} />
          </div>
          {outputs.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {outputs.map(([nodeId, output]) => (
                <li key={nodeId} className="flex flex-col gap-1">
                  <p className="text-sm font-medium text-gray-700">
                    {stepTitleByNode.get(nodeId) ?? "步骤结果"}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-gray-700">
                    {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">这次运行没有产出内容。</p>
          )}
          <details className="mt-1">
            <summary className="cursor-pointer text-sm text-gray-500">查看结果数据（开发者数据）</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-gray-50 p-3 text-xs">
              {JSON.stringify(run.result, null, 2)}
            </pre>
          </details>
        </section>
      ) : null}

      {steps.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
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
                      {JSON.stringify(step.output, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold">执行轨迹</h2>
        {live ? (
          <p className="text-xs text-gray-400">页面会自动更新最新进展</p>
        ) : null}
        <TraceTimeline runId={runId} initialEvents={trace} live={live} />
      </section>

      {decidedApprovals.length > 0 ? (
        <section className="flex flex-col gap-2">
          {/* 普通区块标签：面板自身已带「已确认/未获确认」标题，避免标题嵌套重复 */}
          <p className="text-sm font-semibold">确认记录</p>
          {decidedApprovals.map((approval) => (
            <ApprovalPanel key={approval.id} runId={runId} approval={approval} />
          ))}
        </section>
      ) : null}
    </main>
  );
}
