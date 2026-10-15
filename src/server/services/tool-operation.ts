import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ToolOperationPayload, type ToolOperationInvocation } from "@/contracts/tool-operation";
import type { WorkflowNode } from "@/contracts/workflow";
import { runs, toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { canonicalJson } from "@/server/domain/canonical-json";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { type resolveStepToolOperation, toolOperationDecision, toolOperationKeyMaterial, TOOL_OPERATION_LEASE_MS, validateToolOperationReceipt } from "@/server/domain/runtime/tool-operation";
import { withSafeWorkflowError } from "@/server/security/workflow-error";
import { invokeRegisteredTool } from "@/server/tools/invoke-tool";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";
import type { ToolRegistration } from "@/server/tools/tool-registry";
import type { InlineOutputReferences } from "@/contracts/inline-output-reference";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const failure = (error: string, retryable = false, retryAfterMs?: number): ToolOperationInvocation => ({
  ok: false, error, retryable, ...(retryAfterMs ? { retryAfterMs } : {}),
});

export async function invokeToolOperation(args: {
  runId: string; node: WorkflowNode; tool: ToolRegistration;
  input: Record<string, unknown>; outputs: Record<string, unknown>;
  inlineReferences?: InlineOutputReferences;
  stepInvocation?: Extract<ReturnType<typeof resolveStepToolOperation>, { ok: true }>["stepInvocation"];
  payload: { action: string; input: Record<string, unknown>; outputs: Record<string, unknown> };
}): Promise<ToolOperationInvocation> {
  if (!args.node.tool || !args.node.toolOperation || args.tool.businessIdempotency !== true || !args.tool.businessIdempotencyRetentionMs) {
    return failure("业务工具尚未确认支持跨运行操作防重");
  }
  if (args.stepInvocation && (args.tool.protocol !== "mcp-streamable-http" || args.tool.operationKind !== "action"
    || !args.stepInvocation.idempotencyKey || !Number.isFinite(args.stepInvocation.startedAt?.getTime())
    || typeof args.stepInvocation.mayCreate !== "boolean")) {
    return failure("工具步骤的执行标识无效，已阻止重复写入");
  }
  const bindingIssue = toolRegistrationCompatibilityIssue(args.node.tool, args.tool);
  if (bindingIssue) return failure(bindingIssue);
  const payload = ToolOperationPayload.safeParse(args.payload);
  if (!payload.success) return failure("业务操作请求无法安全保存或超过容量限制");
  const schemaPayload = args.tool.protocol === "mcp-streamable-http" ? payload.data.input : payload.data;
  if (payload.data.action !== args.tool.action
    || validateJsonObjectSchema(schemaPayload, args.node.tool.inputSchema)
    || validateJsonObjectSchema(schemaPayload, args.tool.inputSchema)) return failure("业务操作请求不符合字段契约");
  return withSafeWorkflowError(async () => {
    const owner = randomUUID();
    const requestHash = hash(canonicalJson([
      ...(args.tool.protocol === "mcp-streamable-http" ? [args.tool.protocol, args.tool.operationKind] : []),
      args.tool.endpoint, args.tool.method, [...new Headers(args.tool.headers).entries()],
      args.tool.businessIdempotencyRetentionMs, payload.data,
      ...(args.stepInvocation ? [["workflow-step:v1", args.stepInvocation.idempotencyKey]] : []),
    ]));
    const claim = await db.transaction(async (tx) => {
      const [run] = await tx.select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, status: runs.status })
        .from(runs).where(eq(runs.id, args.runId)).for("update").limit(1);
      if (!run || !["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) {
        return { kind: "rejected" as const, error: "当前运行已经结束，不能发起业务操作" };
      }
      const key = toolOperationKeyMaterial({
        node: args.node, workspaceId: run.workspaceId, toolId: args.tool.id, action: args.tool.action,
        input: args.input, outputs: args.outputs, inlineReferences: args.inlineReferences,
      });
      if (!key.ok) return { kind: "rejected" as const, error: key.error };
      const keyHash = hash(key.material);
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + TOOL_OPERATION_LEASE_MS);
      const legacyRetry = args.stepInvocation?.mayCreate === false;
      const startedAt = args.stepInvocation ? Math.min(now.getTime(), args.stepInvocation.startedAt.getTime()) : now.getTime();
      const [inserted] = await tx.insert(toolOperations).values({
        workspaceId: run.workspaceId, createdBy: run.createdBy, sourceRunId: args.runId,
        nodeTitle: args.node.title, toolId: args.tool.id, action: args.tool.action,
        keyHash, requestHash, status: legacyRetry ? "blocked" : "pending", leaseOwner: legacyRetry ? null : owner, leaseExpiresAt: legacyRetry ? null : leaseExpiresAt,
        ...(legacyRetry ? { error: "旧工具步骤缺少持久防重记录，必须先核对业务系统结果" } : {}),
        retryDeadline: new Date(startedAt + args.tool.businessIdempotencyRetentionMs! - TOOL_OPERATION_LEASE_MS),
      }).onConflictDoNothing().returning();
      if (inserted) return legacyRetry ? { kind: "blocked" as const, row: inserted } : { kind: "execute" as const, row: inserted };
      const [existing] = await tx.select().from(toolOperations).where(and(
        eq(toolOperations.workspaceId, run.workspaceId), eq(toolOperations.keyHash, keyHash),
      )).for("update").limit(1);
      if (!existing) return { kind: "rejected" as const, error: "业务操作领取暂时未确认，请稍后重试" };
      const decision = toolOperationDecision(existing, requestHash, new Date());
      if (decision === "execute" && existing.retryDeadline.getTime() <= Date.now()) {
        await tx.update(toolOperations).set({
          status: "blocked", error: "业务工具防重有效期已过，必须先核对业务系统结果", updatedAt: new Date(),
        }).where(eq(toolOperations.id, existing.id));
        return { kind: "blocked" as const, row: existing };
      }
      if (decision !== "execute") return { kind: decision, row: existing };
      const [claimed] = await tx.update(toolOperations).set({
        leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + TOOL_OPERATION_LEASE_MS), updatedAt: new Date(),
      }).where(eq(toolOperations.id, existing.id)).returning();
      return { kind: "execute" as const, row: claimed };
    });
    if (claim.kind === "rejected") return failure(claim.error);
    if (claim.kind === "conflict") return failure("同一业务操作标识对应的请求内容已变化，请核对任务，不能重复写入");
    if (claim.kind === "blocked") return failure("业务操作结果需要人工核对，不能自动重复写入");
    if (claim.kind === "busy") return failure("相同业务操作正在处理，稍后自动核对回执", true, 60_000);
    if (claim.kind === "cached") {
      const cached = validateToolOperationReceipt(claim.row.receipt, args.node.tool!.outputSchema, args.tool.outputSchema);
      return cached.ok ? {
        ok: true, output: cached.value, operationId: claim.row.id, reused: true,
        confirmedByHuman: claim.row.resolutions.at(-1)?.kind === "record-receipt",
      } : failure(cached.error);
    }
    if (!Number.isFinite(claim.row.retryDeadline.getTime()) || claim.row.retryDeadline.getTime() <= Date.now()) {
      await db.update(toolOperations).set({
        status: "blocked", error: "业务工具防重有效期已过，必须先核对业务系统结果", updatedAt: new Date(),
        leaseOwner: null, leaseExpiresAt: null,
      }).where(and(eq(toolOperations.id, claim.row.id), eq(toolOperations.leaseOwner, owner), eq(toolOperations.status, "pending")));
      return failure("业务工具防重有效期已过，必须先核对业务系统结果");
    }
    const invoked = await invokeRegisteredTool({
      tool: args.tool, idempotencyKey: args.stepInvocation?.idempotencyKey ?? `studio-operation:v1:${claim.row.keyHash}`, ...payload.data,
    });
    const validated = invoked.ok
      ? validateToolOperationReceipt(invoked.output, args.node.tool!.outputSchema, args.tool.outputSchema) : null;
    if (!invoked.ok || !validated?.ok) {
      const retryable = !invoked.ok && invoked.retryable;
      const error = !invoked.ok ? invoked.error : validated && !validated.ok ? validated.error : "业务操作回执尚未确认";
      await db.update(toolOperations).set({
        status: retryable ? "pending" : "blocked", error, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
      }).where(and(eq(toolOperations.id, claim.row.id), eq(toolOperations.leaseOwner, owner), eq(toolOperations.status, "pending")));
      return failure(error, retryable);
    }
    const [saved] = await db.update(toolOperations).set({
      status: "completed", receipt: validated.value, error: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: new Date(),
    }).where(and(eq(toolOperations.id, claim.row.id), eq(toolOperations.leaseOwner, owner), eq(toolOperations.status, "pending")))
      .returning({ id: toolOperations.id });
    if (!saved) return failure("业务操作回执正在核对，请稍后重试", true, 60_000);
    return { ok: true, output: validated.value, operationId: saved.id, reused: false };
  }, "业务操作防重记录暂时无法读写，请稍后重试");
}
