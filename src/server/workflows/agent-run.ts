// 运行编排工作流：只做控制流与状态机推进，所有 I/O 与业务逻辑都在 "use step" 里。
import { createHook, FatalError, sleep } from "workflow";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { requestApproval, recordDecision } from "@/server/steps/approval-step";
import { resolveLoopCollection, workflowExecutionLimit } from "@/server/domain/runtime/loop-runtime";
import { evaluateCondition } from "@/server/steps/condition-step";
import { runKnowledgeStep } from "@/server/steps/knowledge-step";
import { beginLoopIteration, completeLoop } from "@/server/steps/loop-step";
import { runModelStep } from "@/server/steps/model-step";
import { failRun, finalizeRun, initializeRun, markRunRunning } from "@/server/steps/run-state";
import { runQualityGate } from "@/server/steps/quality-step";
import { appendTrace } from "@/server/steps/trace-step";
import { runToolStep } from "@/server/steps/tool-step";
import { beginWait, completeWait } from "@/server/steps/wait-step";

export async function agentRunWorkflow(runId: string, manifest: AgentManifest, input: Record<string, unknown>) {
  "use workflow";
  const draft = manifest.workflowSnapshot;
  await initializeRun(runId, draft);
  let currentId: string | null = draft.startNodeId;
  const outputs: Record<string, unknown> = {};
  const loopStates: Record<string, {
    items: unknown[];
    sourceCount: number;
    limited: boolean;
    index: number;
    iterations: Array<{ iteration: number; item: unknown; bodyOutput: unknown }>;
  }> = {};
  const activeLoops: Array<{ loopId: string; iteration: number; total: number; item: unknown }> = [];
  const executionLimit = workflowExecutionLimit(draft.nodes);
  let guard = 0;
  try {
    while (currentId && guard < executionLimit) {
      guard += 1;
      // 显式标注打断 currentId 收窄与节点类型之间的推导环（TS7022）
      const node: WorkflowNode | undefined = draft.nodes[currentId];
      if (!node) break;
      if (node.type === "trigger") {
        currentId = node.next;
        continue;
      }
      if (node.type === "end") {
        await finalizeRun(runId, outputs);
        return { status: "completed" };
      }
      if (node.type === "ai") {
        const r = await runModelStep({ runId, node, manifest, outputs, input });
        outputs[node.id] = r.output;
        currentId = node.next;
        continue;
      }
      if (node.type === "tool") {
        const r = await runToolStep({ runId, node });
        outputs[node.id] = r.receipt;
        currentId = node.next;
        continue;
      }
      if (node.type === "knowledge") {
        const r = await runKnowledgeStep({ runId, node, manifest, input });
        outputs[node.id] = r.receipt;
        currentId = node.next;
        continue;
      }
      if (node.type === "condition") {
        currentId = await evaluateCondition({ runId, node, outputs, input, currentItem: activeLoops.at(-1)?.item });
        continue;
      }
      if (node.type === "rule") {
        currentId = await runQualityGate({ runId, node, outputs, nodes: draft.nodes });
        continue;
      }
      if (node.type === "system") {
        currentId = node.next;
        continue;
      }
      if (node.type === "human") {
        const { approvalId, token } = await requestApproval({ runId, node, outputs, nodes: draft.nodes });
        const hook = createHook<{ decision: "approved" | "rejected"; note?: string }>({ token });
        const decision = await hook;
        await recordDecision({ runId, node, approvalId, decision });
        await markRunRunning(runId);
        if (decision.decision === "rejected") {
          await appendTrace({
            runId, nodeId: node.id, kind: "run.rejected_stop", level: "warn",
            title: `「${node.title}」未获确认，后续发送类步骤不执行`,
          });
        }
        currentId = decision.decision === "approved" ? node.next : (node.rejectNext ?? "not_approved");
        continue;
      }
      if (node.type === "wait") {
        const wait = node.wait;
        if (!wait) throw new FatalError(`步骤「${node.title}」的等待设置不完整`);
        await beginWait({ runId, node });
        if (wait.mode === "delay") {
          if (wait.durationMs > 0) await sleep(wait.durationMs);
          const output = { resumedBy: "delay", durationMs: wait.durationMs };
          outputs[node.id] = output;
          await completeWait({ runId, node, output });
          currentId = node.next;
          continue;
        }
        if (wait.mode === "until") {
          const until = wait.until ? new Date(wait.until) : null;
          if (!until || Number.isNaN(until.getTime())) throw new FatalError(`步骤「${node.title}」的继续时间不正确`);
          if (until.getTime() > Date.now()) await sleep(until);
          const output = { resumedBy: "time", until: until.toISOString() };
          outputs[node.id] = output;
          await completeWait({ runId, node, output });
          currentId = node.next;
          continue;
        }
        if (!wait.eventKey.trim()) throw new FatalError(`步骤「${node.title}」缺少消息匹配标识`);
        const hook = createHook<Record<string, unknown>>({ token: `wait:${runId}:${wait.eventKey}` });
        const resumed = wait.timeoutMs > 0
          ? await Promise.race([
              hook.then((payload) => ({ kind: "event" as const, payload })),
              sleep(wait.timeoutMs).then(() => ({ kind: "timeout" as const })),
            ])
          : { kind: "event" as const, payload: await hook };
        if (resumed.kind === "timeout") {
          const output = { timedOut: true, timeoutMs: wait.timeoutMs };
          outputs[node.id] = output;
          await completeWait({ runId, node, output, timedOut: true });
          const timeoutNext = wait.onTimeoutNext ?? node.onErrorNext;
          if (!timeoutNext) throw new FatalError(`步骤「${node.title}」等待超时，且没有后续处理步骤`);
          currentId = timeoutNext;
          continue;
        }
        const output = { resumedBy: "event", eventKey: wait.eventKey, payload: resumed.payload };
        outputs[node.id] = output;
        await completeWait({ runId, node, output });
        currentId = node.next;
        continue;
      }
      if (node.type === "loop") {
        const loop = node.loop;
        if (!loop?.bodyNext || !loop.exitNext) throw new FatalError(`步骤「${node.title}」的逐项处理路径不完整`);
        const state = loopStates[node.id] ?? (() => {
          const collection = resolveLoopCollection({
            collectionPath: loop.collectionPath,
            maxIterations: loop.maxIterations,
            input,
            outputs,
          });
          return (loopStates[node.id] = { ...collection, index: 0, iterations: [] });
        })();
        const active = activeLoops.at(-1);
        if (active?.loopId === node.id && active.iteration > state.iterations.length) {
          state.iterations.push({
            iteration: active.iteration,
            item: active.item,
            bodyOutput: outputs[loop.bodyNext],
          });
        }
        if (state.index < state.items.length) {
          const item = state.items[state.index];
          state.index += 1;
          const frame = { loopId: node.id, iteration: state.index, total: state.items.length, item };
          if (active?.loopId === node.id) activeLoops[activeLoops.length - 1] = frame;
          else activeLoops.push(frame);
          outputs[node.id] = {
            itemKey: loop.itemKey,
            currentItem: item,
            iteration: state.index,
            total: state.items.length,
          };
          await beginLoopIteration({ runId, node, iteration: state.index, total: state.items.length, item });
          currentId = loop.bodyNext;
          continue;
        }
        if (activeLoops.at(-1)?.loopId === node.id) activeLoops.pop();
        const output = {
          processedCount: state.index,
          sourceCount: state.sourceCount,
          limited: state.limited,
          iterations: state.iterations,
        };
        outputs[node.id] = output;
        await completeLoop({ runId, node, output });
        currentId = loop.exitNext;
        continue;
      }
      // 其余节点类型 M1 不支持自动执行
      throw new FatalError(`步骤「${node.title}」暂不支持自动执行`);
    }
    await failRun(runId, guard >= executionLimit ? "步骤数超过安全上限，已停止" : "流程没有后续步骤，已停止");
    return { status: "failed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    const reason = /[\u4e00-\u9fff]/.test(message) ? message : "执行步骤时发生错误，已停止";
    if (reason !== message) console.error(`运行 ${runId} 步骤执行失败：`, err);
    try {
      await failRun(runId, reason);
    } catch (failErr) {
      // 兜底写终态失败不得掩盖原错误
      console.error(`运行 ${runId} 写入失败终态时出错：`, failErr);
    }
    throw err;
  }
}
