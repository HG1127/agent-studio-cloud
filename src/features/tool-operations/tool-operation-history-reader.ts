import { ToolOperationGetResult, type ToolOperationResolveInput, type ToolOperationView } from "@/contracts/tool-operation";
import { bindToolOperationReadRequest, copyToolOperationReadPayload, matchToolOperationReadEvidence } from "./tool-operation-read-evidence";

type Binding = NonNullable<ReturnType<typeof bindToolOperationReadRequest>>;
type Clients = {
  read: (operationId: ToolOperationResolveInput["operationId"], signal: AbortSignal) => Promise<ToolOperationGetResult>;
  hashPayload: (payload: ToolOperationResolveInput) => Promise<string | null>;
  onRecorded: (operation: ToolOperationView, payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number) => void;
  onUnconfirmed?: (operation: ToolOperationView, payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number, requestHash: string | null) => void;
};
type ReaderState = {
  phase: "reading" | "slow" | "unknown" | "recorded"; canRead: boolean; canAbort: boolean; message: string;
};
type Reading = { binding: Binding; epoch: number; controller: AbortController; timer: ReturnType<typeof setTimeout> | null };

const originalUnknown = "本次提交结果尚未核实。原请求及全部内容保留，可手动读取历史。";
const historyUnknown = "最新历史仍不能确认本次提交。原请求及全部内容保持不变，提交结果仍未知，请继续核对。";

export function createToolOperationHistoryReader() {
  const initial: ReaderState = { phase: "unknown", canRead: false, canAbort: false, message: originalUnknown };
  let snapshot = initial;
  let mounted = false;
  let binding: Binding | null = null;
  let enabled = false;
  let clients: Clients | null = null;
  let highest: { generation: number; key: string; blocked: boolean } | null = null;
  let epoch = 0;
  let current: Reading | null = null;
  const listeners = new Set<() => void>();

  function publish(phase: ReaderState["phase"], message: string) {
    snapshot = { phase, message, canRead: mounted && enabled && binding !== null && current === null, canAbort: mounted && current !== null };
    for (const listener of listeners) listener();
  }

  function finish(reading: Reading) {
    if (reading.timer !== null) clearTimeout(reading.timer);
    reading.timer = null;
    if (current === reading) current = null;
  }

  function cancelCurrent() {
    epoch += 1;
    const reading = current;
    if (reading) { reading.controller.abort(); finish(reading); }
  }

  function isCurrent(reading: Reading) {
    return mounted && enabled && current === reading && reading.epoch === epoch
      && binding?.key === reading.binding.key && !reading.controller.signal.aborted;
  }

  function bind(payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number, readEnabled: boolean, nextClients: Clients) {
    let next = bindToolOperationReadRequest(payload, sourceRunId, requestGeneration);
    if (next) {
      if (highest === null || next.requestGeneration > highest.generation) {
        highest = { generation: next.requestGeneration, key: next.key, blocked: false };
      } else if (next.requestGeneration < highest.generation || highest.blocked || next.key !== highest.key) {
        highest.blocked = true;
        next = null;
      }
    } else if (highest) highest.blocked = true;
    clients = { ...nextClients };
    if (binding?.key === next?.key && enabled === readEnabled) return;
    cancelCurrent();
    binding = next; enabled = readEnabled;
    publish("unknown", !binding
      ? "原请求无法确认，当前不能读取。请保留原提交并联系维护人员，离页保护仍保留。"
      : !enabled ? "请先等待原提交结束，再手动核对固定请求的历史。原提交不会被撤销或重发。" : originalUnknown);
  }

  async function read() {
    if (!mounted || !enabled || !binding || !clients || current) return;
    const original = binding;
    const client = clients;
    const reading: Reading = { binding: original, epoch: ++epoch, controller: new AbortController(), timer: null };
    current = reading;
    publish("reading", "正在读取并核对原请求历史，不会重新提交。");
    reading.timer = setTimeout(() => {
      if (isCurrent(reading)) publish("slow", "这次读取与核对较慢。可继续等待，或中止本次读取后手动重读；不会撤销或重新发送原提交。");
    }, 5000);
    try {
      const response = await client.read(original.payload.operationId, reading.controller.signal);
      if (!isCurrent(reading)) return;
      const parsed = ToolOperationGetResult.safeParse(response);
      if (parsed.success && parsed.data.ok && (parsed.data.operation.id !== original.payload.operationId || parsed.data.operation.sourceRunId !== original.sourceRunId)) {
        finish(reading); publish("unknown", "核对详情与本次操作所属任务不一致，仍不能确认本次提交。原请求仍保留，请联系维护人员核对。"); return;
      }
      if (!parsed.success || !parsed.data.ok || parsed.data.operation.id !== original.payload.operationId
        || parsed.data.operation.sourceRunId !== original.sourceRunId || parsed.data.operation.resolutions.length >= 50) {
        finish(reading); publish("unknown", historyUnknown); return;
      }
      const requestHash = await client.hashPayload(copyToolOperationReadPayload(original.payload));
      if (!isCurrent(reading)) return;
      const observed = matchToolOperationReadEvidence(original, parsed.data, requestHash);
      if (observed) {
        client.onRecorded(observed, copyToolOperationReadPayload(original.payload), original.sourceRunId, original.requestGeneration);
        if (!isCurrent(reading)) return;
        finish(reading);
        publish("recorded", "已在可核对历史中找到本次核对记录。这里只确认结论已登记，不表示业务工具执行成功、旧任务恢复或产生了新运行。");
      } else {
        client.onUnconfirmed?.(parsed.data.operation, copyToolOperationReadPayload(original.payload), original.sourceRunId, original.requestGeneration, requestHash);
        if (!isCurrent(reading)) return;
        finish(reading); publish("unknown", historyUnknown);
      }
    } catch {
      if (isCurrent(reading)) { finish(reading); publish("unknown", "最新历史未取得或无法核对，仍不能确认本次提交。原请求仍保留，全部内容未改变；可手动重新读取。"); }
    } finally { finish(reading); }
  }

  function abort() {
    if (!mounted || !current) return;
    cancelCurrent();
    publish("unknown", "本次历史读取已中止。原提交及全部内容仍保留，提交结果仍未知；可手动重新读取。");
  }

  return {
    bind, read, abort,
    connect() { mounted = true; publish(snapshot.phase, snapshot.message); },
    disconnect() {
      mounted = false; cancelCurrent();
      snapshot = { phase: "unknown", canRead: false, canAbort: false, message: originalUnknown };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
