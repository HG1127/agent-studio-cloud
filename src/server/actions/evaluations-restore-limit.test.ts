import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_EVALUATION_CASES } from "@/contracts/evaluation";

const mocks = vi.hoisted(() => ({
  selectCall: 0,
  activeCount: 100,
  update: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({
  db: {
    transaction: async (run: (tx: unknown) => unknown) => run({
      select: () => {
        const rows = [
          [{ id: "00000000-0000-4000-8000-0000000000a1", name: "测试助手" }],
          [],
          [{ id: "00000000-0000-4000-8000-0000000000a2", archivedAt: new Date() }],
          [{ count: mocks.activeCount }],
        ][mocks.selectCall++] ?? [];
        const query = {
          limit: async () => rows,
          for: () => ({ limit: async () => rows }),
          then: (resolve: (value: unknown[]) => void) => resolve(rows),
        };
        return { from: () => ({ where: () => query }) };
      },
      update: mocks.update,
    }),
  },
}));

import { setEvaluationCaseArchivedAction } from "./evaluations";

beforeEach(() => {
  mocks.selectCall = 0;
  mocks.activeCount = MAX_EVALUATION_CASES;
  mocks.update.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("恢复验收样例的数量上限", () => {
  it("启用样例已满时拒绝恢复，不写入数据库", async () => {
    const result = await setEvaluationCaseArchivedAction({
      agentId: "00000000-0000-4000-8000-0000000000a1",
      caseId: "00000000-0000-4000-8000-0000000000a2",
      archived: false,
    });

    expect(result).toEqual({ ok: false, error: `每个助手最多保留 ${MAX_EVALUATION_CASES} 条启用中的验收样例` });
    expect(mocks.selectCall).toBe(4);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
