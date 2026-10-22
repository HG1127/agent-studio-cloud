import { describe, expect, it } from "vitest";
import { harnessRunDetailHref, harnessRunHref } from "@/features/harness/harness-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";

const runId = "00000000-0000-4000-8000-000000000081";
describe("诊断任务往返地址", () => {
  it("固定任务和安全锚点往返，仍保留运行列表筛选的原有行为", () => {
    const url = new URL(harnessRunDetailHref(runId, "run-waiting"), "https://local.invalid");
    expect(url.hash).toBe("#run-waiting");
    expect(runReturnHref(url.searchParams.get("from") ?? undefined)).toBe(harnessRunHref(runId));
    expect(runReturnHref("/runs?status=failed&source=manual&page=2")).toBe("/runs?status=failed&source=manual&page=2");
  });
  it.each([
    "https://outside.example/harness?run=" + runId, "//outside.example/harness?run=" + runId,
    "/harness", "/harness?run=invalid", "/harness?run=", "/harness?run=" + runId + "#trace",
    "/harness?run=" + runId + "&from=https://outside.example", "/harness?run=" + runId + "&run=" + runId,
    "/harness/../agents?run=" + runId, "/harness?redirect=" + runId,
  ])("不接受非白名单返回值 %s", (raw) => {
    expect(runReturnHref(raw)).toBe("/runs");
  });
});
