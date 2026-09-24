import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft, type WorkflowDraft as WorkflowDraftType } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updates: [] as Array<{ value: Record<string, unknown> }>,
  lock: vi.fn(),
  revalidatePath: vi.fn(),
  applySafeAuditFixes: vi.fn(),
}));

const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        for: () => {
          mocks.lock();
          return { limit: async () => mocks.selectRows.shift() ?? [] };
        },
        orderBy: () => ({ limit: async () => mocks.selectRows.shift() ?? [] }),
      }),
    }),
  }),
  update: () => ({
    set: (value: Record<string, unknown>) => ({
      where: async () => {
        mocks.updates.push({ value });
        return [];
      },
    }),
  }),
};

vi.mock("@/lib/db", () => ({ db: { transaction: async (run: (client: typeof tx) => unknown) => run(tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/domain/audit/safe-audit-fixes", () => ({ applySafeAuditFixes: mocks.applySafeAuditFixes }));

import { applyAuditFixesAction } from "@/server/actions/apply-audit-fixes";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { updateAgentAction } from "@/server/actions/update-agent";

const AGENT_ID = "00000000-0000-4000-8000-000000000071";
const draft: WorkflowDraftType = {
  id: "draft-1",
  versionId: null,
  startNodeId: "start",
  rootAgent: { id: AGENT_ID, name: "页面里的旧名称", role: "主助手" },
  nodes: {},
  variables: [],
  memoryPolicy: { taskContext: true, longTerm: false },
  ui: { positions: {} },
};

beforeEach(() => {
  mocks.selectRows = [];
  mocks.updates = [];
  mocks.lock.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.applySafeAuditFixes.mockReset();
});

describe("助手与流程并发写入", () => {
  it("保存流程时锁定助手并使用数据库中的当前名称", async () => {
    mocks.selectRows = [[{ name: "当前名称" }], [{ id: "definition-1" }]];

    const result = await saveWorkflowAction(AGENT_ID, draft);

    expect(result).toEqual({ ok: true });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].value.draft).toMatchObject({ rootAgent: { name: "当前名称" } });
  });

  it("已归档或不存在的助手不能被旧页面写回流程", async () => {
    mocks.selectRows = [[]];

    const result = await saveWorkflowAction(AGENT_ID, draft);

    expect(result).toEqual({ ok: false, error: "找不到这个助手，或助手已归档，请刷新页面后重试" });
    expect(mocks.updates).toHaveLength(0);
  });

  it("服务端拒绝保存引用已删除步骤的最终交付", async () => {
    const invalid = WorkflowDraft.parse({
      ...draft,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "done" },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
      outputContract: { fields: [{ path: "plan", label: "方案", required: true, sourceNodeId: "deleted" }] },
    });

    expect(await saveWorkflowAction(AGENT_ID, invalid)).toEqual({
      ok: false,
      error: "最终交付“方案”必须选择有效的业务步骤来源",
    });
    expect(mocks.lock).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });

  it("修改名称时使用同一助手行锁并同步流程名称", async () => {
    mocks.selectRows = [[{ id: AGENT_ID }], [{ id: "definition-1", draft }]];

    const result = await updateAgentAction({ agentId: AGENT_ID, name: "新名称", description: "新说明" });

    expect(result).toEqual({ ok: true });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[1].value.draft).toMatchObject({ rootAgent: { name: "新名称" } });
  });

  it("自动修复也锁定助手后再写入最新草稿", async () => {
    mocks.selectRows = [[{ id: AGENT_ID }], [{ id: "definition-1", draft }]];
    mocks.applySafeAuditFixes.mockReturnValue({
      draft: { ...draft, rootAgent: { ...draft.rootAgent, role: "已修复" } },
      applied: ["补充安全边界"],
      skipped: [],
      remainingCritical: 0,
      remainingWarnings: 0,
    });

    const result = await applyAuditFixesAction(AGENT_ID);

    expect(result).toMatchObject({ ok: true, applied: ["补充安全边界"] });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0].value.draft).toMatchObject({ rootAgent: { role: "已修复" } });
  });
});
