import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDraft } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({
  selectRows: [] as unknown[][],
  updates: [] as Array<{ value: Record<string, unknown> }>,
  lock: vi.fn(),
  revalidatePath: vi.fn(),
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

import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { updateAgentAction } from "@/server/actions/update-agent";

const AGENT_ID = "00000000-0000-4000-8000-000000000071";
const draft: WorkflowDraft = {
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

  it("修改名称时使用同一助手行锁并同步流程名称", async () => {
    mocks.selectRows = [[{ id: AGENT_ID }], [{ id: "definition-1", draft }]];

    const result = await updateAgentAction({ agentId: AGENT_ID, name: "新名称", description: "新说明" });

    expect(result).toEqual({ ok: true });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(2);
    expect(mocks.updates[1].value.draft).toMatchObject({ rootAgent: { name: "新名称" } });
  });
});
