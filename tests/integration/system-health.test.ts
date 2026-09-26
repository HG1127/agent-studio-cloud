import { describe, expect, it } from "vitest";
import { isDatabaseReady } from "@/server/queries/system-health";

describe("数据库迁移就绪检查", () => {
  it("在完整迁移后的隔离数据库返回就绪", async () => {
    await expect(isDatabaseReady()).resolves.toBe(true);
  });
});
