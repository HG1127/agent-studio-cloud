import { beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationCaseUpdateInput } from "@/contracts/evaluation";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), selectCall: 0, update: vi.fn(), set: vi.fn(), insert: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));

import { createEvaluationCaseAction, updateEvaluationCaseAction } from "./evaluations";

const agentId = "00000000-0000-4000-8000-000000000001";
const caseId = "00000000-0000-4000-8000-000000000002";
const updatedAt = new Date("2026-10-09T00:00:00Z");
const resultSchema = { type: "object", description: "x".repeat(31 * 1024) };
const input = { agentId, caseId, name: "保留规则", input: { text: "x".repeat(97 * 1024) }, expectations: [], expectedUpdatedAt: updatedAt.toISOString() };

beforeEach(() => {
  mocks.selectCall = 0;
  mocks.revalidate.mockReset();
  mocks.set.mockReset().mockReturnValue({ where: () => ({ returning: async () => [{ id: caseId }] }) });
  mocks.update.mockReset().mockReturnValue({ set: mocks.set });
  mocks.insert.mockReset().mockReturnValue({ values: async () => undefined });
  mocks.transaction.mockReset().mockImplementation(async (work: (tx: unknown) => unknown) => work({
    select: () => {
      const rows = [[{ id: agentId, name: "规则助手" }], [], [{ id: caseId, name: input.name, input: {}, expectations: [], resultSchema, updatedAt }]][mocks.selectCall++] ?? [];
      const query = { limit: async () => rows, for: () => ({ limit: async () => rows }) };
      return { from: () => ({ where: () => query }) };
    },
    update: mocks.update,
    insert: mocks.insert,
  }));
});

describe("验收结果规则写入边界", () => {
  it.each([{ type: "object", $ref: "unknown" }, { type: "object", const: { apiKey: "short-secret" } }])("无效规则在查询前拒绝，不泄露字面量 %#", async (schema) => {
    const create = await createEvaluationCaseAction({ ...input, input: {}, resultSchema: schema });
    const update = await updateEvaluationCaseAction({ ...input, input: {}, resultSchema: schema });
    expect(create.ok).toBe(false);
    expect(update.ok).toBe(false);
    expect(JSON.stringify([create, update])).not.toContain("short-secret");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("省略规则的请求本身有效，合并后超限仍不写样例或操作记录", async () => {
    expect(EvaluationCaseUpdateInput.safeParse(input).success).toBe(true);
    expect(await updateEvaluationCaseAction(input)).toEqual({ ok: false, error: "单条验收样例不能超过 128KB" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("明确清除规则后同一大输入可保存，不退化为禁止旧页面修改", async () => {
    expect(await updateEvaluationCaseAction({ ...input, resultSchema: null })).toEqual({ ok: true });
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ input: input.input, resultSchema: null }));
    expect(mocks.insert).toHaveBeenCalledOnce();
  });
});
