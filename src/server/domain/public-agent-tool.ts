import { createHash, timingSafeEqual } from "node:crypto";
import { AgentManifest } from "@/contracts/manifest";
import { isPassiveJsonData } from "@/contracts/json";
import { PublicToolCallReceipt, PublicToolPublication, PublicToolView, type PublicToolStoredCall } from "@/contracts/public-agent-tool";
import { MAX_RUN_INPUT_BYTES, MAX_RUN_RESULT_BYTES, RunInputPayload, RunStatus } from "@/contracts/run";
import { validateRunInput } from "@/server/domain/runtime/run-input";
import { validateOutputFieldPaths } from "@/server/domain/runtime/output-contract";
import { isCredentialFieldName, redactCredentialText } from "@/server/domain/security/redact-sensitive";

export function publicToolHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalPublicToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPublicToolValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      // 持久摘要不能随地区排序改变，也不能合并规范等价但不同的键。
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalPublicToolValue(child)]));
  }
  return value;
}
export function publicToolCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalPublicToolValue(value));
}
export function publicToolAdminCredentialMatches(supplied: string, configured: string | undefined): boolean {
  return typeof configured === "string" && /^[A-Za-z0-9._~-]{32,256}$/.test(configured)
    && typeof supplied === "string" && /^[A-Za-z0-9._~-]{32,256}$/.test(supplied)
    && timingSafeEqual(Buffer.from(publicToolHash(supplied), "hex"), Buffer.from(publicToolHash(configured), "hex"));
}
export function publicToolSourceKey(toolId: string, requestId: string): string {
  return `public-tool:${PublicToolView.shape.toolId.parse(toolId)}:${PublicToolCallReceipt.shape.requestId.parse(requestId)}`;
}
export function publicToolHasCredentials(value: unknown): boolean {
  const stack = [value];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (stack.length) {
    if (++visited > 50_000) return true;
    const current = stack.pop();
    if (current && typeof current === "object") {
      if (seen.has(current)) return true;
      seen.add(current);
    }
    if (typeof current === "string" && (redactCredentialText(current) !== current || /\bpat_[a-f0-9]{64}\b/.test(current))) return true;
    if (Array.isArray(current)) for (const child of current) stack.push(child);
    else if (current && typeof current === "object") for (const [key, child] of Object.entries(current)) {
      if (isCredentialFieldName(key) && child !== null && child !== "") return true;
      stack.push(child);
    }
  }
  return false;
}
export function publicToolInputHash(input: Record<string, unknown>): string {
  if (!isPassiveJsonData(input, MAX_RUN_INPUT_BYTES)) throw new Error("工具输入无效");
  const parsed = RunInputPayload.parse(input);
  if (!isPassiveJsonData(parsed, MAX_RUN_INPUT_BYTES) || publicToolHasCredentials(parsed)) throw new Error("工具输入不能包含凭据");
  return publicToolHash(publicToolCanonicalJson(parsed));
}
export function freezePublicToolPublication(args: {
  agentId: string; versionId: string; version: number; manifest: unknown; publicationId: string; now: Date;
}): PublicToolPublication {
  const manifest = AgentManifest.parse(args.manifest);
  if (manifest.designAudit.status === "blocked" || manifest.designAudit.criticalCount > 0) throw new Error("助手版本未通过设计检查");
  if (!manifest.outputContract?.fields.length || validateOutputFieldPaths(manifest.outputContract.fields)) throw new Error("公开工具必须配置有效的最终交付字段");
  if (manifest.inputContract.fields.some((field) => isCredentialFieldName(field.name))
    || manifest.outputContract.fields.some((field) => field.path.split(".").some(isCredentialFieldName) || field.sourcePath?.some(isCredentialFieldName))
    || publicToolHasCredentials({ fields: manifest.inputContract.fields, output: manifest.outputContract })
    || redactCredentialText(JSON.stringify(manifest)) !== JSON.stringify(manifest)
    || /\bpat_[a-f0-9]{64}\b/.test(JSON.stringify(manifest))) throw new Error("公开工具发布内容不能包含凭据");
  return PublicToolPublication.parse({
    publicationId: args.publicationId, agentId: args.agentId, versionId: args.versionId, version: args.version,
    manifestHash: publicToolHash(publicToolCanonicalJson(manifest)), workflowFingerprint: manifest.workflowFingerprint,
    inputContract: manifest.inputContract, outputContract: manifest.outputContract, publishedAt: args.now.toISOString(),
  });
}
export function publicToolPublicationMatches(publication: PublicToolPublication, manifest: unknown): boolean {
  const parsed = AgentManifest.safeParse(manifest);
  return parsed.success && publicToolHash(publicToolCanonicalJson(parsed.data)) === publication.manifestHash;
}
export function publicToolInputIssue(publication: PublicToolPublication, input: Record<string, unknown>): string | null {
  if (publicToolHasCredentials(input)) return "工具输入不能包含凭据";
  if (publication.inputContract.fields.length === 0 && Object.keys(input).length) return "这个工具没有声明输入字段";
  return validateRunInput(input, publication.inputContract.fields);
}
export function presentPublicTool(row: {
  id: string; name: string; description: string; status: string; revision: number; publication: unknown; createdAt: Date; updatedAt: Date;
}): PublicToolView {
  const publication = row.publication === null ? null : PublicToolPublication.parse(row.publication);
  const view = PublicToolView.parse({ toolId: row.id, name: row.name, description: row.description, status: row.status, revision: row.revision,
    publication, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
  if (publicToolHasCredentials(view)) throw new Error("工具元数据不能包含凭据");
  return view;
}
function requiredOutputsPresent(result: Record<string, unknown>, publication: PublicToolPublication): boolean {
  return publication.outputContract.fields.every((field) => {
    if (!field.required) return true;
    let value: unknown = result;
    for (const segment of field.path.trim().split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, segment)) return false;
      value = (value as Record<string, unknown>)[segment];
    }
    return value !== undefined && value !== null;
  });
}
function onlyDeclaredOutputs(result: Record<string, unknown>, publication: PublicToolPublication): boolean {
  const paths = publication.outputContract.fields.map((field) => field.path.trim());
  const stack: Array<{ value: unknown; path: string }> = [{ value: result, path: "" }];
  while (stack.length) {
    const { value, path } = stack.pop()!;
    if (paths.includes(path)) continue;
    if (path && !paths.some((candidate) => candidate.startsWith(path + "."))) return false;
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    for (const [key, child] of Object.entries(value)) stack.push({ value: child, path: path ? path + "." + key : key });
  }
  return true;
}
export function presentPublicToolCall(call: PublicToolStoredCall, run: {
  id: string; agentId: string; versionId: string; sourceType: string; sourceKey: string | null; status: string; result: unknown;
} | null): PublicToolCallReceipt {
  let state: PublicToolCallReceipt["state"] = call.runId ? "unknown" : "start_unknown";
  let result: PublicToolCallReceipt["result"] = null;
  let error: string | null = null;
  if (run) {
    const status = RunStatus.safeParse(run.status);
    const bound = run.agentId === call.publication.agentId && run.versionId === call.publication.versionId
      && run.sourceType === "manual" && run.sourceKey === publicToolSourceKey(call.toolId, call.requestId)
      && (!call.runId || call.runId === run.id);
    state = status.success && bound ? status.data : "unknown";
    if (state === "completed") {
      const parsed = isPassiveJsonData(run.result, MAX_RUN_RESULT_BYTES)
        ? PublicToolCallReceipt.shape.result.safeParse(run.result) : null;
      if (!parsed?.success || !parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)
        || publicToolHasCredentials(parsed.data) || !requiredOutputsPresent(parsed.data, call.publication) || !onlyDeclaredOutputs(parsed.data, call.publication)) {
        state = "unknown"; error = "成果内容暂时无法确认";
      } else result = parsed.data;
    } else if (state === "failed") error = "任务执行失败，请由管理员核对";
    else if (state === "cancelled") error = "任务已取消";
    else if (state === "unknown") error = "任务状态暂时无法确认";
  }
  return PublicToolCallReceipt.parse({
    toolId: call.toolId, requestId: call.requestId, origin: "public-agent-tool", received: true, deliveryConfirmed: false,
    publicationId: call.publication.publicationId, version: call.publication.version, state,
    resultAvailable: state === "completed", result, error, receivedAt: call.receivedAt,
    statusUrl: `/api/public-tools/${call.toolId}/calls/${call.requestId}`,
  });
}
