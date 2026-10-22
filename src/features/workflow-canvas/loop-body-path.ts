import { MAX_WORKFLOW_NODES, WorkflowNodeType, type WorkflowDraft, type WorkflowNode } from "@/contracts/workflow";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

type PathStep = { nodeId: WorkflowNode["id"]; title: string };
type StopKind = "source-missing" | "source-mismatch" | "not-loop" | "unconfigured" | "body-not-set" | "exit-not-set" | "exit-missing" | "exit-mismatch" | "invalid-boundary" | "self-reference" | "returned-loop" | "exit-reached" | "repeated" | "missing" | "identity-mismatch" | "unsupported" | "branch" | "control" | "no-next" | "unknown-next" | "limit";
type PathView = { steps: PathStep[]; stop: { kind: StopKind; message: string } };

function stopAt(steps: PathStep[], kind: StopKind, message: string): PathView {
  return { steps, stop: { kind, message } };
}

function safeTitle(node: WorkflowNode, index: number, identifiers: readonly string[]) {
  const title = typeof node.title === "string" ? redactSensitiveText(node.title.trim()) : "";
  const folded = title.toLowerCase();
  const containsIdentity = identifiers.some((id) => id.length > 1 && folded.includes(id.toLowerCase()));
  return !title || !/\p{Script=Han}/u.test(title) || title === node.id || containsIdentity
    || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(title)
    ? "处理步骤 " + String(index + 1) + "（名称待核对）" : title;
}

function boundary(node: WorkflowNode): { kind: "branch" | "control"; message: string } | null {
  if (node.type === "condition") return { kind: "branch", message: "遇到分情况处理，实际去向由条件判断决定；未选择或猜测其中的分支，直接路径在此停止。" };
  if (node.type === "loop") return { kind: "control", message: "遇到另一处逐项处理，它有自己的循环路径；直接路径在此停止，不展开或猜测内部循环。" };
  if (node.type === "human") return { kind: "branch", message: "遇到员工确认步骤，去向取决于人工决定；直接路径在此停止，不认为已获确认。" };
  if (node.type === "wait") return { kind: "control", message: "遇到等待步骤，需要核对等待方式及可能的超时处理；直接路径在此停止，不认为已经恢复执行。" };
  if (node.type === "parallel" || node.type === "subflow") return { kind: "control", message: "遇到并行工作或步骤组，内部处理不能只按一条后续连接解释；直接路径在此停止。" };
  if (node.type === "end") return { kind: "control", message: "遇到流程完成步骤，直接路径在此停止；不据此判断循环内所有列表项已处理完。" };
  if (node.type === "trigger") return { kind: "control", message: "内部路径指向启动步骤，不能按普通处理步骤继续展开；请先核对流程连接。" };
  if (node.controlPlane || node.ui?.visibility === "control" || node.quality || node.type === "rule" && node.rule?.kind !== "business_rule") return { kind: "control", message: "遇到系统控制或结果检查步骤，需要单独核对处理规则；直接路径在此停止，不认为检查已通过。" };
  if (node.rejectNext || node.onErrorNext) return { kind: "branch", message: "这一步另有未通过或未完成时的处理路径；直接路径在此停止，不选择其中一路代替实际执行。" };
  return null;
}

export function loopBodyPath(loopId: WorkflowNode["id"], nodes: WorkflowDraft["nodes"]): PathView {
  const steps: PathStep[] = [];
  if (!Object.hasOwn(nodes, loopId)) return stopAt(steps, "source-missing", "当前循环步骤尚未读到，无法展开内部路径；这不是没有内部步骤的结论。");
  const loopNode = nodes[loopId];
  if (!loopNode || loopNode.id !== loopId) return stopAt(steps, "source-mismatch", "当前循环步骤与流程记录无法对应，未使用该记录展开路径；请先核对定义。");
  if (loopNode.type !== "loop") return stopAt(steps, "not-loop", "当前选择不是逐项处理步骤，不能将它的后续连接解释成循环内部路径。");
  if (!loopNode.loop) return stopAt(steps, "unconfigured", "当前循环设置尚未读到，无法核对内部路径的起点和边界。");
  const { bodyNext, exitNext } = loopNode.loop;
  if (typeof bodyNext !== "string" || !bodyNext.trim()) return stopAt(steps, "body-not-set", "尚未指定每项处理的起点，无法展开这段内部路径；不据此判断没有工作需要处理。");
  if (typeof exitNext !== "string" || !exitNext.trim()) return stopAt(steps, "exit-not-set", "循环后的去向尚未指定，内部路径边界无法核对；请先核对循环设置。");
  if (!Object.hasOwn(nodes, exitNext)) return stopAt(steps, "exit-missing", "循环后的关联步骤尚未读到，内部路径边界无法核对；未显示或猜测未知去向。");
  if (!nodes[exitNext] || nodes[exitNext].id !== exitNext) return stopAt(steps, "exit-mismatch", "循环后的关联步骤与流程记录无法对应，内部路径边界无法核对。");
  if (exitNext === loopId || bodyNext === exitNext) return stopAt(steps, "invalid-boundary", "每项处理的起点与循环后的去向不能形成可核对的边界，内部路径未展开；请先核对连接。");
  const identifiers = [...Object.keys(nodes), ...Object.values(nodes).map((node) => node?.id).filter((id): id is string => typeof id === "string")];
  const seen = new Set<string>();
  let currentId = bodyNext;
  for (let count = 0; count < MAX_WORKFLOW_NODES; count += 1) {
    if (currentId === loopId) return stopAt(steps, steps.length ? "returned-loop" : "self-reference", steps.length
      ? "直接连接已指回当前循环，查看在此停止；是否进入下一项由实际运行决定，不代表列表已处理完。"
      : "每项处理的起点直接指回当前循环，尚未形成可查看的内部处理路径；请先核对连接。");
    if (currentId === exitNext) return stopAt(steps, "exit-reached", "直接连接已到达循环后的去向，内部路径查看在此停止；不据此判断所有列表项已处理完。");
    if (seen.has(currentId)) return stopAt(steps, "repeated", "直接连接再次指向已列出的步骤，形成回环；未重复展开，也不判断这代表循环已完成。");
    if (!Object.hasOwn(nodes, currentId)) return stopAt(steps, "missing", "下一关联步骤尚未读到，直接路径在此停止；未显示或猜测未知步骤。");
    const node = nodes[currentId];
    if (!node || node.id !== currentId) return stopAt(steps, "identity-mismatch", "下一步骤与流程记录无法对应，直接路径在此停止；未将其他记录当作该步骤。");
    if (!WorkflowNodeType.safeParse(node.type).success) return stopAt(steps, "unsupported", "下一步骤的处理类型无法核对，不能只按后续连接继续解释路径。");
    seen.add(currentId);
    steps.push({ nodeId: currentId, title: safeTitle(node, steps.length, identifiers) });
    const stopping = boundary(node);
    if (stopping) return { steps, stop: stopping };
    if (node.next === null) return stopAt(steps, "no-next", "这段直接连接没有后续步骤，尚未连接回当前循环；不据此判断列表已处理完。");
    if (typeof node.next !== "string" || !node.next.trim()) return stopAt(steps, "unknown-next", "后续连接字段暂时无法核对，直接路径在此停止；不据此判断本项已结束。");
    currentId = node.next;
  }
  return stopAt(steps, "limit", "直接路径已达到可查看的步骤上限，未继续展开；这不是循环完成的结论。");
}
