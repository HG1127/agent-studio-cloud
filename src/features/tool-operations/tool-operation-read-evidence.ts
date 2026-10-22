import { ToolOperationGetResult, ToolOperationResolveInput, ToolOperationView } from "@/contracts/tool-operation";

export function copyToolOperationReadPayload(payload: ToolOperationResolveInput): ToolOperationResolveInput {
  const parsed = ToolOperationResolveInput.parse(payload);
  return ToolOperationResolveInput.parse(JSON.parse(JSON.stringify(parsed)) as unknown);
}

export function bindToolOperationReadRequest(payload: ToolOperationResolveInput, sourceRunId: ToolOperationView["sourceRunId"], requestGeneration: number) {
  try {
    const input = ToolOperationResolveInput.safeParse(payload);
    const source = ToolOperationView.shape.sourceRunId.safeParse(sourceRunId);
    if (!input.success || !source.success || !Number.isSafeInteger(requestGeneration) || requestGeneration < 0) return null;
    const original = copyToolOperationReadPayload(input.data);
    return { payload: original, sourceRunId: source.data, requestGeneration, key: JSON.stringify([requestGeneration, source.data, original]) };
  } catch { return null; }
}

export function matchToolOperationReadEvidence(
  binding: ReturnType<typeof bindToolOperationReadRequest>, result: unknown, requestHash: string | null,
): ToolOperationView | null {
  try {
    if (!binding || requestHash === null || !/^[a-f0-9]{64}$/.test(requestHash)) return null;
    const parsed = ToolOperationGetResult.safeParse(result);
    if (!parsed.success || !parsed.data.ok) return null;
    const operation = parsed.data.operation;
    if (operation.id !== binding.payload.operationId || operation.sourceRunId !== binding.sourceRunId || operation.resolutions.length >= 50) return null;
    const records = operation.resolutions.filter((record) => record.requestId === binding.payload.requestId);
    if (records.length !== 1 || records[0].kind !== binding.payload.kind || records[0].requestHash !== requestHash) return null;
    return operation;
  } catch { return null; }
}
