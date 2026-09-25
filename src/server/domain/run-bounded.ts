export async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const workerCount = Math.min(items.length, Math.max(1, Math.trunc(concurrency)));
  let cursor = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index], index);
    }
  }));
}
