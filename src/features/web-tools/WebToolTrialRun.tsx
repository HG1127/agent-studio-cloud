import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useId, useLayoutEffect, useRef, useState } from "react";
import { Play, ShieldAlert } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import type { StartRunResult } from "@/contracts/run";
import { RunTaskStartInput } from "@/contracts/run-task";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { startRunTaskAction } from "@/server/actions/start-run-task";
import { RunResourceLimitNotice } from "@/features/runs/RunResourceLimitNotice";
import type { PreparedPreviewInput } from "./preview-input";
import { webToolRunHref } from "./web-tool-navigation";
import { WebToolTrialProtection } from "./WebToolTrialProtection";

export function WebToolTrialRun({ target, prepare, onLockedChange }: {
  target: AgentTargetOption;
  prepare: () => PreparedPreviewInput;
  onLockedChange: (locked: boolean) => void;
}) {
  return <WebToolTrialSession key={`${target.agentId}:${target.versionId}`} target={target} prepare={prepare} onLockedChange={onLockedChange} />;
}

function WebToolTrialSession({ target, prepare, onLockedChange }: {
  target: AgentTargetOption;
  prepare: () => PreparedPreviewInput;
  onLockedChange: (locked: boolean) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [prepared, setPrepared] = useState<PreparedPreviewInput | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resourceLimit, setResourceLimit] = useState<unknown>(undefined);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const lifecycle = useRef(0);
  const mayNavigate = useRef(true);
  const needsCheck = useRef(false);
  const created = useRef<string | null>(null);
  const preparedInput = useRef<PreparedPreviewInput | null>(null);
  const request = useRef<RunTaskStartInput | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    mayNavigate.current = true;
    lifecycle.current += 1;
    return () => { mounted.current = false; mayNavigate.current = false; lifecycle.current += 1; };
  }, []);

  function review() {
    if (!mounted.current || running.current || created.current) return;
    setError(null);
    setResourceLimit(undefined);
    if (needsCheck.current) { start(); return; }
    if (!RunTaskStartInput.shape.agentId.safeParse(target.agentId).success || !RunTaskStartInput.shape.versionId.unwrap().safeParse(target.versionId).success) {
      setError("本页选择的助手或版本暂时无法核对，请重新选择；没有提交任务，完整填写仍保留。");
      return;
    }
    const next = prepare();
    if (!next.input) return;
    preparedInput.current = next;
    setPrepared(next);
    setOpen(true);
  }

  function start() {
    if (!mounted.current || running.current || created.current || (!request.current && !preparedInput.current?.input)) return;
    let submitted = request.current;
    if (!submitted) {
      try {
        const parsed = RunTaskStartInput.safeParse({ agentId: target.agentId, versionId: target.versionId, input: preparedInput.current!.input!, requestId: crypto.randomUUID() });
        if (!parsed.success || !parsed.data.versionId) {
          setOpen(false);
          setError("暂时无法按任务要求准备这次请求，请重新核对版本与填写；没有提交任务，完整填写仍保留。");
          return;
        }
        submitted = parsed.data;
      } catch {
        setOpen(false);
        setError("暂时无法准备这次请求，请重新确认；没有提交任务，完整填写仍保留。");
        return;
      }
    }
    running.current = true;
    setPending(true);
    onLockedChange(true);
    setError(null);
    setResourceLimit(undefined);
    request.current = submitted;
    const fixedRequest = submitted;
    const checking = needsCheck.current;
    const generation = lifecycle.current;
    startTransition(async () => {
      let result: StartRunResult;
      try {
        result = await startRunTaskAction(fixedRequest);
      } catch {
        if (!mounted.current || lifecycle.current !== generation) return;
        needsCheck.current = true;
        setUncertain(true);
        setOpen(false);
        setError("暂时无法确认是否已创建任务。先核对上次请求或查看运行记录；不要按新的请求重复提交。");
        setPending(false);
        running.current = false;
        return;
      }
      if (!mounted.current || lifecycle.current !== generation) return;
      setOpen(false);
      setPending(false);
      running.current = false;
      if (!result.ok) {
        setResourceLimit(result.resourceLimit);
        setError(checking ? `${result.error}。上次请求仍需核对，不能据此认定没有创建任务。` : result.error);
        if (checking || result.retryable === true) {
          needsCheck.current = true;
          setUncertain(true);
        } else { request.current = null; onLockedChange(false); }
        return;
      }
      created.current = result.runId;
      request.current = null;
      needsCheck.current = false;
      setUncertain(false);
      setStartedRunId(result.runId);
      onLockedChange(false);
      if (mayNavigate.current) {
        try { router.push(webToolRunHref(target.versionId, result.runId)); } catch { /* 已确认创建，保留详情入口，不再次提交。 */ }
      }
    });
  }

  return <section aria-labelledby={`${id}-title`} className="mt-5 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
    <WebToolTrialProtection isLocked={() => running.current || needsCheck.current} onLeave={() => { mayNavigate.current = false; }} />
    <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldAlert aria-hidden="true" className="size-4 shrink-0 text-amber-700" />内部试运行</h3>
    <p className="mt-2 text-sm leading-6 text-slate-700">可以将本页填写交给这位助手真实执行。会保存输入并创建运行记录，业务工具可能写入外部系统；不会发布网页工具或生成对外网址。</p>
    <p id={`${id}-version-note`} className="mt-2 text-xs leading-5 text-amber-900">本次将指定本页选定的版本 {target.version}，不会自动改用后来发布的新版本；指定版本是否可用由服务端核对。创建记录不等于已执行、已完成或通过验收，请在任务详情核对实际版本与执行结果。</p>
    {pending ? <p role="status" className="mt-3 text-sm leading-6 text-amber-950">正在确认任务是否创建。请留在本页等待；离开或关闭页面不会取消后台任务。</p> : null}
    {error ? <div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-white p-3 text-sm leading-6 text-amber-950"><p>{error}</p><RunResourceLimitNotice resourceLimit={resourceLimit} />{uncertain ? <p className="mt-1 text-xs">上次请求的输入已锁定；核对会沿用同一个请求，不提交新的填写。离开或关闭本页后，请先查看运行记录。</p> : null}<Link href={`/runs?agent=${target.agentId}`} className="mt-2 inline-block font-semibold underline underline-offset-2">查看这位助手的运行记录</Link></div> : null}
    {startedRunId ? <div role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm leading-6 text-emerald-950"><p>已创建真实运行记录，是否完成请以任务详情为准。可处理任务后返回网页工具回看结果。</p><Link href={webToolRunHref(target.versionId, startedRunId)} prefetch={false} className="mt-1 inline-block font-semibold underline underline-offset-2">打开本次任务详情</Link></div> : <button ref={trigger} type="button" disabled={pending} aria-busy={pending} aria-describedby={`${id}-version-note`} onClick={review} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50"><Play aria-hidden="true" className="size-4" />{pending ? (uncertain ? "正在核对上次请求…" : "正在创建真实任务…") : uncertain ? "核对上次试运行" : "用这些填写试运行"}</button>}
    <ConfirmDialog open={open} onOpenChange={setOpen} title="确认创建真实试运行？" description={`将保存这次填写并指定「${target.agentName}」的版本 ${target.version}，可能调用业务工具、产生费用或等待人工确认。指定版本是否可用由服务端核对，不会自动改用后来发布的新版本；创建记录不等于已执行、已完成或通过验收。这不是网页工具的公开调用，也不保证运行成功。已核对 ${prepared?.checkedFields ?? 0} 项填写格式。`} confirmLabel="确认并创建任务" pending={pending} tone="warning" onConfirm={start} returnFocusRef={trigger} />
  </section>;
}
