import { describe, expect, it } from "vitest";
import {
  MAX_COLLABORATION_DEPTH,
  parseCollaborationParentId,
  type CollaborationRunRef,
  validateCollaborationTarget,
} from "@/server/domain/runtime/collaboration-chain";

function run(runId: string, agentId: string, sourceType = "agent_call", sourceKey: string | null = null): CollaborationRunRef {
  return { runId, agentId, sourceType, sourceKey };
}

describe("助手协作调用链", () => {
  it("识别协作与交接来源中的上级运行", () => {
    expect(parseCollaborationParentId(run("child", "b", "agent_call", "agent-call:00000000-0000-4000-8000-000000000001:step")))
      .toBe("00000000-0000-4000-8000-000000000001");
    expect(parseCollaborationParentId(run("child", "b", "handoff", "handoff:00000000-0000-4000-8000-000000000002:step")))
      .toBe("00000000-0000-4000-8000-000000000002");
    expect(parseCollaborationParentId(run("root", "a", "manual", null))).toBeNull();
  });

  it("阻止目标助手出现在任意祖先位置", () => {
    const chain = [run("current", "c"), run("parent", "b"), run("root", "a", "manual")];
    expect(validateCollaborationTarget(chain, "a")).toContain("循环");
    expect(validateCollaborationTarget(chain, "b")).toContain("循环");
    expect(validateCollaborationTarget(chain, "d")).toBeNull();
  });

  it("允许到达上限但阻止继续创建更深的协作运行", () => {
    const allowed = Array.from({ length: MAX_COLLABORATION_DEPTH }, (_, index) => run(`run-${index}`, `agent-${index}`));
    const blocked = [...allowed, run("root", "root-agent", "manual")];
    expect(validateCollaborationTarget(allowed, "next-agent")).toBeNull();
    expect(validateCollaborationTarget(blocked, "next-agent")).toContain(`${MAX_COLLABORATION_DEPTH} 层`);
  });
});
