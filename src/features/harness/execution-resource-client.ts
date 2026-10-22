import {
  ExecutionPolicyHistoryInput, ExecutionPolicyHistoryResult, ExecutionPolicyReadResult, ExecutionPolicyWriteResult,
  type ExecutionPolicyInput,
} from "@/contracts/execution-resources";

export async function readExecutionResources(): Promise<ExecutionPolicyReadResult> {
  try {
    const response = await fetch("/api/execution/resources", { cache: "no-store", credentials: "same-origin" });
    const result = ExecutionPolicyReadResult.parse(await response.json());
    if (result.ok && !response.ok) throw new Error("Unexpected read status");
    return result;
  } catch {
    return { ok: false, error: "资源摘要暂时无法读取，当前上限与可用名额未知。" };
  }
}

export async function readExecutionResourceHistory(beforeRevision?: number): Promise<ExecutionPolicyHistoryResult> {
  try {
    const input = ExecutionPolicyHistoryInput.parse({ limit: 20, ...(beforeRevision === undefined ? {} : { beforeRevision }) });
    const query = new URLSearchParams({ limit: String(input.limit) });
    if (input.beforeRevision !== undefined) query.set("beforeRevision", String(input.beforeRevision));
    const response = await fetch("/api/execution/resources/history?" + query, { cache: "no-store", credentials: "same-origin" });
    const result = ExecutionPolicyHistoryResult.parse(await response.json());
    if (result.ok && (!response.ok || result.items.length > input.limit || result.items.some((item) => input.beforeRevision !== undefined && item.revision >= input.beforeRevision))) throw new Error("Unexpected history scope");
    return result;
  } catch {
    return { ok: false, error: "资源设置历史暂时无法读取，不能判断本页是否有记录。" };
  }
}

export async function writeExecutionResources(input: ExecutionPolicyInput): Promise<ExecutionPolicyWriteResult> {
  try {
    const response = await fetch("/api/execution/resources", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    const result = ExecutionPolicyWriteResult.parse(await response.json());
    if (result.ok && (!response.ok || result.recordedRevision !== input.expectedRevision + 1
      || (result.policy.revision === result.recordedRevision && Object.keys(input.limits).some((key) => result.policy.limits[key as keyof typeof input.limits] !== input.limits[key as keyof typeof input.limits])))) throw new Error("Unexpected policy receipt");
    return result;
  } catch {
    return { ok: false, error: "保存结果暂时无法确认。当前原请求仍保留，请先核对记录或沿用原请求重试。", retryable: true };
  }
}
