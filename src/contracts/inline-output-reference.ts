import { z } from "zod";
import { MAX_INPUT_BINDINGS } from "./input-mapping";
import { MAX_SUBFLOW_STEPS } from "./workflow";

const NodeId = z.string().min(1).max(200);
export const InlineOutputReference = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subflow"), ownerNodeId: NodeId, stepIndex: z.number().int().min(0).max(MAX_SUBFLOW_STEPS - 1) }).strict(),
  z.object({ kind: z.literal("parallel"), ownerNodeId: NodeId, branchId: z.string().min(1).max(200) }).strict(),
]);
export type InlineOutputReference = z.infer<typeof InlineOutputReference>;

export const InlineOutputReferences = z.record(NodeId, InlineOutputReference).superRefine((value, context) => {
  if (Object.keys(value).length > MAX_INPUT_BINDINGS + 1) context.addIssue({ code: "custom", message: "内部来源定位超过单步映射上限" });
});
export type InlineOutputReferences = z.infer<typeof InlineOutputReferences>;
