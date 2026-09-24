// 运行编排工作流：只做控制流与状态机推进，所有 I/O 与业务逻辑都在 "use step" 里。
import { createHook, FatalError, sleep } from "workflow";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { requestApproval, recordDecision } from "@/server/steps/approval-step";
import { MAX_COLLABORATION_DEPTH } from "@/server/domain/runtime/collaboration-chain";
import { resolveLoopCollection, workflowExecutionLimit } from "@/server/domain/runtime/loop-runtime";
import { prepareParallelBranches, resolveParallelOutcome, type PreparedParallelBranch } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow, type PreparedSubflow } from "@/server/domain/runtime/subflow-runtime";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";
import { evaluateCondition } from "@/server/steps/condition-step";
import { beginAgentCall, finishAgentCall } from "@/server/steps/agent-call-step";
import { beginHandoff, finishHandoff } from "@/server/steps/handoff-step";
import { runInlineSystemStep } from "@/server/steps/inline-system-step";
import { runKnowledgeStep } from "@/server/steps/knowledge-step";
import { beginLoopIteration, completeLoop } from "@/server/steps/loop-step";
import { runMemoryStep } from "@/server/steps/memory-step";
import { runModelStep } from "@/server/steps/model-step";
import { beginParallel, finishParallel } from "@/server/steps/parallel-step";
import { failRun, finalizeRun, initializeRun, markRunRunning } from "@/server/steps/run-state";
import { beginSubflow, finishSubflow } from "@/server/steps/subflow-step";
import { runQualityGate } from "@/server/steps/quality-step";
import { appendTrace } from "@/server/steps/trace-step";
import { runToolStep } from "@/server/steps/tool-step";
import { beginWait, completeWait } from "@/server/steps/wait-step";

type ParallelBranchResult = {
  id: string;
  label: string;
  status: "completed" | "failed";
  outputs: Record<string, unknown>;
  error?: string;
};

function executionFailureReason(error: unknown, fallback: string): string {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error ?? "");
  return /[\u4e00-\u9fff]/.test(message) ? message : fallback;
}

async function executeAutomaticNode(args: {
  runId: string;
  node: WorkflowNode;
  manifest: AgentManifest;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
  depth: number;
}): Promise<unknown> {
  if (args.node.type === "ai") {
    return (await runModelStep(args)).output;
  }
  if (args.node.type === "tool") {
    return (await runToolStep({ runId: args.runId, node: args.node })).receipt;
  }
  if (args.node.type === "knowledge") {
    return (await runKnowledgeStep({ runId: args.runId, node: args.node, manifest: args.manifest, input: args.input })).receipt;
  }
  if (args.node.type === "system") {
    return (await runInlineSystemStep({ runId: args.runId, node: args.node })).output;
  }
  if (args.node.type === "memory") {
    return (await runMemoryStep({ runId: args.runId, node: args.node, input: args.input, outputs: args.outputs })).output;
  }
  if (args.node.type === "agent_call") {
    if (args.depth >= MAX_COLLABORATION_DEPTH) throw new FatalError(`步骤「${args.node.title}」超过助手协作层级上限`);
    const prepared = await beginAgentCall({ runId: args.runId, node: args.node, parentInput: args.input, outputs: args.outputs });
    const [settled] = await Promise.allSettled([
      agentRunWorkflow(prepared.childRunId, prepared.manifest, prepared.input, { depth: args.depth + 1 }),
    ]);
    if (settled.status === "fulfilled") {
      return (await finishAgentCall({ runId: args.runId, childRunId: prepared.childRunId, node: args.node, targetName: prepared.targetName })).output;
    }
    const reason = executionFailureReason(settled.reason, `协作助手「${prepared.targetName}」执行失败`);
    await finishAgentCall({ runId: args.runId, childRunId: prepared.childRunId, node: args.node, targetName: prepared.targetName, failed: true, handled: false, error: reason });
    throw new FatalError(reason);
  }
  if (args.node.type === "handoff") {
    if (args.depth >= MAX_COLLABORATION_DEPTH) throw new FatalError(`步骤「${args.node.title}」超过助手交接层级上限`);
    const prepared = await beginHandoff({ runId: args.runId, node: args.node, parentInput: args.input, outputs: args.outputs });
    const [settled] = await Promise.allSettled([
      agentRunWorkflow(prepared.childRunId, prepared.manifest, prepared.input, { depth: args.depth + 1 }),
    ]);
    if (settled.status === "fulfilled") {
      return (await finishHandoff({ runId: args.runId, childRunId: prepared.childRunId, node: args.node, targetName: prepared.targetName })).output;
    }
    const reason = executionFailureReason(settled.reason, `接收助手「${prepared.targetName}」执行失败`);
    await finishHandoff({ runId: args.runId, childRunId: prepared.childRunId, node: args.node, targetName: prepared.targetName, failed: true, handled: false, error: reason });
    throw new FatalError(reason);
  }
  throw new FatalError(`步骤「${args.node.title}」暂不支持自动执行`);
}

async function executeParallelBranch(args: {
  runId: string;
  branch: PreparedParallelBranch;
  manifest: AgentManifest;
  input: Record<string, unknown>;
  parentOutputs: Record<string, unknown>;
  depth: number;
}): Promise<ParallelBranchResult> {
  const branchOutputs: Record<string, unknown> = {};
  for (const node of args.branch.steps) {
    branchOutputs[node.id] = await executeAutomaticNode({
      runId: args.runId,
      node,
      manifest: args.manifest,
      input: args.input,
      outputs: { ...args.parentOutputs, ...branchOutputs },
      depth: args.depth,
    });
  }
  return { id: args.branch.id, label: args.branch.label, status: "completed", outputs: branchOutputs };
}

async function executeSubflow(args: {
  runId: string;
  subflow: PreparedSubflow;
  manifest: AgentManifest;
  input: Record<string, unknown>;
  parentOutputs: Record<string, unknown>;
  depth: number;
}): Promise<Array<{ title: string; output: unknown }>> {
  const childOutputs: Record<string, unknown> = {};
  const steps: Array<{ title: string; output: unknown }> = [];
  for (const node of args.subflow.steps) {
    const output = await executeAutomaticNode({
      runId: args.runId,
      node,
      manifest: args.manifest,
      input: args.input,
      outputs: { ...args.parentOutputs, ...childOutputs },
      depth: args.depth,
    });
    childOutputs[node.id] = output;
    steps.push({ title: node.title, output });
  }
  return steps;
}

export async function agentRunWorkflow(
  runId: string,
  manifest: AgentManifest,
  input: Record<string, unknown>,
  executionContext: { depth: number } = { depth: 0 },
) {
  "use workflow";
  const draft = manifest.workflowSnapshot;
  await initializeRun(runId, draft);
  let currentId: string | null = draft.startNodeId;
  const outputs: Record<string, unknown> = {};
  const loopStates: Record<string, {
    items: unknown[];
    sourceCount: number;
    limited: boolean;
    sourceMissing: boolean;
    index: number;
    iterations: Array<{ iteration: number; item: unknown; bodyOutput: unknown }>;
  }> = {};
  const activeLoops: Array<{ loopId: string; iteration: number; total: number; item: unknown }> = [];
  const qualityRepairAttempts: Record<string, number> = {};
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
        const projected = projectWorkflowResult(outputs, manifest.outputContract?.fields ?? []);
        if (!projected.ok) throw new FatalError(`缺少必需交付内容：${projected.missing.join("、")}`);
        await finalizeRun(runId, projected.result, outputs);
        return { status: "completed" };
      }
      if (node.type === "ai") {
        try {
          const r = await runModelStep({ runId, node, manifest, outputs, input });
          outputs[node.id] = r.output;
          currentId = node.next;
        } catch (error) {
          if (!node.onErrorNext) throw error;
          const reason = executionFailureReason(error, `步骤「${node.title}」执行失败`);
          outputs[node.id] = { status: "failed", error: reason };
          await appendTrace({ runId, nodeId: node.id, kind: "step.failed_handled", level: "warn", title: `「${node.title}」未完成，转入备用处理`, detail: reason });
          currentId = node.onErrorNext;
        }
        continue;
      }
      if (node.type === "tool") {
        try {
          const r = await runToolStep({ runId, node });
          outputs[node.id] = r.receipt;
          currentId = node.next;
        } catch (error) {
          if (!node.onErrorNext) throw error;
          const reason = executionFailureReason(error, `步骤「${node.title}」执行失败`);
          outputs[node.id] = { status: "failed", error: reason };
          await appendTrace({ runId, nodeId: node.id, kind: "step.failed_handled", level: "warn", title: `「${node.title}」未完成，转入备用处理`, detail: reason });
          currentId = node.onErrorNext;
        }
        continue;
      }
      if (node.type === "knowledge") {
        const r = await runKnowledgeStep({ runId, node, manifest, input });
        outputs[node.id] = r.receipt;
        currentId = node.next;
        continue;
      }
      if (node.type === "memory") {
        const result = await runMemoryStep({ runId, node, input, outputs });
        outputs[node.id] = result.output;
        currentId = node.next;
        continue;
      }
      if (node.type === "agent_call") {
        if (executionContext.depth >= MAX_COLLABORATION_DEPTH) throw new FatalError(`步骤「${node.title}」超过助手协作层级上限`);
        const preparedCall = await beginAgentCall({ runId, node, parentInput: input, outputs });
        const [settled] = await Promise.allSettled([
          agentRunWorkflow(preparedCall.childRunId, preparedCall.manifest, preparedCall.input, { depth: executionContext.depth + 1 }),
        ]);
        if (settled.status === "fulfilled") {
          const result = await finishAgentCall({ runId, childRunId: preparedCall.childRunId, node, targetName: preparedCall.targetName });
          outputs[node.id] = result.output;
          currentId = node.next;
          continue;
        }
        const reason = executionFailureReason(settled.reason, `协作助手「${preparedCall.targetName}」执行失败`);
        const handled = Boolean(node.onErrorNext);
        const result = await finishAgentCall({
          runId,
          childRunId: preparedCall.childRunId,
          node,
          targetName: preparedCall.targetName,
          failed: true,
          handled,
          error: reason,
        });
        outputs[node.id] = result.output;
        if (node.onErrorNext) {
          currentId = node.onErrorNext;
          continue;
        }
        throw new FatalError(`步骤「${node.title}」未能完成`);
      }
      if (node.type === "handoff") {
        if (executionContext.depth >= MAX_COLLABORATION_DEPTH) throw new FatalError(`步骤「${node.title}」超过助手交接层级上限`);
        const preparedHandoff = await beginHandoff({ runId, node, parentInput: input, outputs });
        const [settled] = await Promise.allSettled([
          agentRunWorkflow(preparedHandoff.childRunId, preparedHandoff.manifest, preparedHandoff.input, { depth: executionContext.depth + 1 }),
        ]);
        if (settled.status === "fulfilled") {
          const result = await finishHandoff({ runId, childRunId: preparedHandoff.childRunId, node, targetName: preparedHandoff.targetName });
          outputs[node.id] = result.output;
          currentId = node.next;
          continue;
        }
        const reason = executionFailureReason(settled.reason, `接收助手「${preparedHandoff.targetName}」执行失败`);
        const handled = Boolean(node.onErrorNext);
        const result = await finishHandoff({
          runId,
          childRunId: preparedHandoff.childRunId,
          node,
          targetName: preparedHandoff.targetName,
          failed: true,
          handled,
          error: reason,
        });
        outputs[node.id] = result.output;
        if (node.onErrorNext) {
          currentId = node.onErrorNext;
          continue;
        }
        throw new FatalError(`步骤「${node.title}」未能完成`);
      }
      if (node.type === "condition") {
        currentId = await evaluateCondition({ runId, node, outputs, input, currentItem: activeLoops.at(-1)?.item });
        continue;
      }
      if (node.type === "rule") {
        const quality = await runQualityGate({ runId, node, outputs, nodes: draft.nodes, repairAttempts: qualityRepairAttempts });
        if (quality.repair) {
          const repairNode = draft.nodes[quality.repair.nodeId];
          if (!repairNode || repairNode.type !== "ai") throw new FatalError("质量返工目标不存在或不支持自动重写");
          qualityRepairAttempts[repairNode.id] = quality.repair.nextRepairAttempt;
          const repaired = await runModelStep({
            runId,
            node: repairNode,
            manifest,
            outputs,
            input,
            qualityFeedback: quality.repair.feedback,
          });
          outputs[repairNode.id] = repaired.output;
          currentId = node.id;
          continue;
        }
        currentId = quality.next;
        continue;
      }
      if (node.type === "system") {
        const result = await runInlineSystemStep({ runId, node });
        outputs[node.id] = result.output;
        currentId = node.next;
        continue;
      }
      if (node.type === "human") {
        const { approvalId, token } = await requestApproval({ runId, node, outputs, nodes: draft.nodes });
        const hook = createHook<{ decision: "approved" | "rejected"; note?: string }>({ token });
        const decision = await hook;
        await recordDecision({ runId, node, approvalId, decision });
        const resumed = await markRunRunning(runId);
        if (!resumed) throw new FatalError("运行已经结束，不能继续确认后的步骤");
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
          if (collection.sourceMissing) {
            throw new FatalError(`步骤「${node.title}」没有在“${loop.collectionPath}”找到可逐项处理的列表`);
          }
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
      if (node.type === "parallel") {
        const prepared = prepareParallelBranches(node);
        if (!prepared.ok) throw new FatalError(prepared.error);
        await beginParallel({ runId, node, branchCount: prepared.branches.length });
        const settledBranches = await Promise.allSettled(prepared.branches.map((branch) => executeParallelBranch({
          runId,
          branch,
          manifest,
          input,
          parentOutputs: outputs,
          depth: executionContext.depth,
        })));
        const branchResults: ParallelBranchResult[] = settledBranches.map((result, index) => {
          if (result.status === "fulfilled") return result.value;
          const branch = prepared.branches[index];
          return {
            id: branch.id,
            label: branch.label,
            status: "failed",
            outputs: {},
            error: executionFailureReason(result.reason, `并行工作「${branch.label}」执行失败`),
          };
        });
        const failed = branchResults.filter((branch) => branch.status === "failed");
        const outcome = resolveParallelOutcome({
          strategy: node.parallel!.strategy,
          failurePolicy: node.parallel!.failurePolicy,
          statuses: branchResults.map((branch) => branch.status),
        });
        const output = {
          strategy: node.parallel?.strategy,
          status: outcome.status,
          completedCount: branchResults.length - failed.length,
          failedCount: failed.length,
          ...(outcome.selectedIndex === null ? {} : { selectedBranchId: branchResults[outcome.selectedIndex].id }),
          branches: Object.fromEntries(branchResults.map((branch) => [branch.id, branch])),
        };
        outputs[node.id] = output;
        if (outcome.shouldFail) {
          const handled = Boolean(node.onErrorNext);
          await finishParallel({ runId, node, output, failed: true, handled });
          if (node.onErrorNext) {
            currentId = node.onErrorNext;
            continue;
          }
          throw new FatalError(node.parallel?.strategy === "any"
            ? `步骤「${node.title}」没有任何一项并行工作完成`
            : `步骤「${node.title}」有 ${failed.length} 项并行工作未完成`);
        }
        await finishParallel({ runId, node, output, failed: outcome.status === "completed_with_issues", handled: true });
        currentId = node.next;
        continue;
      }
      if (node.type === "subflow") {
        const prepared = prepareSubflow(node);
        if (!prepared.ok) throw new FatalError(prepared.error);
        await beginSubflow({ runId, node, stepCount: prepared.steps.length });
        const [settled] = await Promise.allSettled([executeSubflow({
          runId,
          subflow: prepared,
          manifest,
          input,
          parentOutputs: outputs,
          depth: executionContext.depth,
        })]);
        if (settled.status === "fulfilled") {
          const output = {
            name: prepared.name,
            status: "completed",
            expectedOutputs: prepared.outputNames,
            steps: settled.value,
          };
          outputs[node.id] = output;
          await finishSubflow({ runId, node, output, failed: false, handled: true });
          currentId = node.next;
          continue;
        }
        const output = {
          name: prepared.name,
          status: "failed",
          expectedOutputs: prepared.outputNames,
          error: executionFailureReason(settled.reason, `一组步骤「${prepared.name}」执行失败`),
        };
        outputs[node.id] = output;
        const handled = prepared.failurePolicy === "continue" || Boolean(node.onErrorNext);
        await finishSubflow({ runId, node, output, failed: true, handled });
        if (prepared.failurePolicy === "continue") {
          currentId = node.next;
          continue;
        }
        if (node.onErrorNext) {
          currentId = node.onErrorNext;
          continue;
        }
        throw new FatalError(`步骤「${node.title}」未能完成`);
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
