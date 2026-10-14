import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  source: {
    agentId: "00000000-0000-4000-8000-000000000071",
    versionId: "00000000-0000-4000-8000-000000000072",
    input: { question: "原问题" },
    sourceType: "manual",
  } as { agentId: string; versionId: string; input: Record<string, unknown>; sourceType: string } | null,
  startRun: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.source ? [mocks.source] : [] }),
      }),
    }),
  },
}));
vi.mock("@/server/services/start-run-core", () => ({ startRunCore: mocks.startRun }));

import { retryRunAction } from "@/server/actions/retry-run";

const RUN_ID = "00000000-0000-4000-8000-000000000073";
const REQUEST_ID = "00000000-0000-4000-8000-000000000074";

describe("再次运行幂等键", () => {
  beforeEach(() => {
    if (mocks.source) mocks.source.sourceType = "manual";
    mocks.startRun.mockReset().mockResolvedValue({
      ok: true,
      runId: "00000000-0000-4000-8000-000000000075",
    });
    mocks.revalidatePath.mockReset();
  });

  it("把原运行和本次请求映射为唯一来源键", async () => {
    await retryRunAction(RUN_ID, REQUEST_ID);

    expect(mocks.startRun).toHaveBeenCalledWith({
      agentId: mocks.source?.agentId,
      versionId: mocks.source?.versionId,
      input: mocks.source?.input,
      sourceType: "manual",
      sourceKey: `manual-retry:${RUN_ID}:${REQUEST_ID}`,
    });
  });

  it("再次运行状态待确认时抛出错误以保留原请求标识", async () => {
    mocks.startRun.mockResolvedValueOnce({ ok: false, error: "运行启动状态待确认", retryable: true });

    await expect(retryRunAction(RUN_ID, REQUEST_ID)).rejects.toThrow("运行启动状态待确认");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("再次运行容量拒绝返回资源原因，同一次请求等待释放后可继续", async () => {
    const refused = { ok: false as const, error: "当前执行链并发名额已满，请等待已有任务结束后重试", retryable: true as const,
      resourceLimit: { kind: "concurrent-chains" as const, current: 1, maximum: 1 } };
    mocks.startRun.mockResolvedValueOnce(refused);

    await expect(retryRunAction(RUN_ID, REQUEST_ID)).resolves.toEqual(refused);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    await expect(retryRunAction(RUN_ID, REQUEST_ID)).resolves.toMatchObject({ ok: true });
    expect(mocks.startRun.mock.calls[0]).toEqual(mocks.startRun.mock.calls[1]);
  });

  it("新运行已启动后缓存刷新失败不误报再次运行失败", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });

    await expect(retryRunAction(RUN_ID, REQUEST_ID)).resolves.toEqual({
      ok: true, runId: "00000000-0000-4000-8000-000000000075",
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/runs", `/runs/${RUN_ID}`]);
    log.mockRestore();
  });

  it("拒绝无效请求标识", async () => {
    await expect(retryRunAction(RUN_ID, "bad")).resolves.toEqual({
      ok: false,
      error: "运行信息不正确，请刷新页面后重试",
    });
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  it("自动验收运行不能绕过发布门禁单独重跑", async () => {
    if (mocks.source) mocks.source.sourceType = "evaluation";

    await expect(retryRunAction(RUN_ID, REQUEST_ID)).resolves.toEqual({
      ok: false,
      error: "自动验收的运行不能单独再次运行，请在验收页面重新发起",
    });
    expect(mocks.startRun).not.toHaveBeenCalled();
  });
});
