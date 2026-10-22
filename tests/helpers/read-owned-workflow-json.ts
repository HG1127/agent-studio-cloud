import { open, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { BigIntStats } from "node:fs";
import { createHash } from "node:crypto";

function reject(): never { throw new Error("验收文件完整性或归属未确认"); }
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
    && left.nlink === BigInt(1) && right.nlink === BigInt(1) && left.isFile() && right.isFile();
}
export async function readOwnedWorkflowJsonWithHash(file: string, maximumBytes: number): Promise<{ value: unknown; sha256: string }> {
  if (!path.isAbsolute(file) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024) reject();
  const directory = path.dirname(file);
  for (let current = directory; ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
    if (path.dirname(current) === current) break;
  }
  const canonical = await realpath(directory);
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(canonical) !== normalize(directory)) reject();
  const before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== BigInt(1) || before.size > BigInt(maximumBytes)) reject();
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameFile(before, opened)) reject();
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (length > maximumBytes || BigInt(length) !== opened.size) reject();
    const afterHandle = await handle.stat({ bigint: true }), afterPath = await lstat(file, { bigint: true });
    if (!sameFile(opened, afterHandle) || !sameFile(opened, afterPath) || afterPath.isSymbolicLink()
      || normalize(await realpath(directory)) !== normalize(canonical)) reject();
    const bytes = buffer.subarray(0, length);
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch { reject(); }
  finally { await handle.close(); }
}

export async function readOwnedWorkflowJson(file: string, maximumBytes: number): Promise<unknown> {
  return (await readOwnedWorkflowJsonWithHash(file, maximumBytes)).value;
}
