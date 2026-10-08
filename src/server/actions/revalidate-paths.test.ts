import { afterEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath }));

import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

afterEach(() => revalidatePath.mockReset());

describe("已提交写操作的缓存刷新", () => {
  it("某个路径刷新失败后继续尝试其他路径，不覆盖写入结果", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    revalidatePath.mockImplementationOnce(() => { throw new Error("暂时不可用"); });

    expect(() => revalidatePathsAfterCommit(["/runs/1", "/agents/2", "/memory"], "regression"))
      .not.toThrow();
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/runs/1", "/agents/2", "/memory"]);
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
