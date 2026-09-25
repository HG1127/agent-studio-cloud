import { describe, expect, it, vi } from "vitest";
import { runBounded } from "@/server/domain/run-bounded";

describe("受控并发执行", () => {
  it("处理全部任务且不超过并发上限", async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    await runBounded([0, 1, 2, 3, 4, 5, 6], 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, item % 2 === 0 ? 4 : 1));
      completed.push(item);
      active -= 1;
    });

    expect(peak).toBe(3);
    expect(completed.sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("空任务列表不会调用处理函数，非法并发数按一条执行", async () => {
    const task = async () => undefined;
    const emptyTask = vi.fn(task);
    await runBounded([], 5, emptyTask);
    expect(emptyTask).not.toHaveBeenCalled();

    let active = 0;
    let peak = 0;
    await runBounded([1, 2, 3], 0, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    });
    expect(peak).toBe(1);
  });
});
