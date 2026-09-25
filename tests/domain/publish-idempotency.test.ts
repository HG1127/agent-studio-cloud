import { describe, expect, it } from "vitest";
import { isDuplicatePublishedVersion } from "@/server/domain/publish-idempotency";

describe("发布版本幂等判断", () => {
  const manifest = {
    workflowFingerprint: "same",
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
    knowledgeSnapshot: [],
  };

  it("仅把相同发布级别和完整清单视为重复发布", () => {
    expect(isDuplicatePublishedVersion({ status: "candidate", manifest }, "candidate", structuredClone(manifest))).toBe(true);
    expect(isDuplicatePublishedVersion({ status: "candidate", manifest }, "production", manifest)).toBe(false);
    expect(isDuplicatePublishedVersion(
      { status: "candidate", manifest },
      "candidate",
      { ...manifest, knowledgeSnapshot: ["changed"] },
    )).toBe(false);
  });

  it("没有最新版本时允许发布", () => {
    expect(isDuplicatePublishedVersion(null, "candidate", manifest)).toBe(false);
  });
});
