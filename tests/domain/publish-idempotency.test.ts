import { describe, expect, it } from "vitest";
import { isDuplicatePublishedVersion } from "@/server/domain/publish-idempotency";
import { buildManifest } from "@/server/domain/pipeline";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { mvpTemplateInput, mvpTemplateRegistry } from "../fixtures/mvp-template";

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

  it.each(["candidate", "production"] as const)("真实模板清单经过 JSON 持久表示后仍是同一 %s 发布", (release) => {
    const built = buildMvpTemplate(mvpTemplateInput, mvpTemplateRegistry);
    if (!built.ok) throw new Error(built.error);
    const generated = buildManifest(built.draft, { modelId: "test-model", mock: false, connectionId: null, knowledgeSnapshot: [] });
    const persisted = JSON.parse(JSON.stringify(generated));
    expect(Object.hasOwn(generated, "requirementCoverage")).toBe(true);
    expect(generated.requirementCoverage).toBeUndefined();
    expect(Object.hasOwn(persisted, "requirementCoverage")).toBe(false);
    expect(Object.hasOwn(persisted, "complexityProfile")).toBe(false);
    expect(isDuplicatePublishedVersion({ status: release, manifest: persisted }, release, generated)).toBe(true);
    expect(Object.hasOwn(generated, "requirementCoverage")).toBe(true);
    expect(Object.hasOwn(persisted, "requirementCoverage")).toBe(false);
  });

  it("嵌套可选标签被 JSON 丢弃，不误判成新发布", () => {
    const generated = { ...manifest, inputContract: { fields: [{ name: "customerId", label: undefined, required: true, type: "string" }] } };
    const persisted = JSON.parse(JSON.stringify(generated));
    expect(isDuplicatePublishedVersion({ status: "production", manifest: persisted }, "production", generated)).toBe(true);
  });

  it("即使指纹相同，模型、输入、交付来源、工具规则与审计变化仍是不同清单", () => {
    const built = buildMvpTemplate(mvpTemplateInput, mvpTemplateRegistry);
    if (!built.ok) throw new Error(built.error);
    const generated = buildManifest(built.draft, { modelId: "test-model", mock: false, connectionId: null, knowledgeSnapshot: [] });
    const persisted = JSON.parse(JSON.stringify(generated));
    const mutations: Array<(value: typeof generated) => void> = [
      (value) => { value.resourceSelection.model.modelId = "other-model"; },
      (value) => { value.resourceSelection.model.mock = true; },
      (value) => { value.resourceSelection.model.connectionId = "00000000-0000-4000-8000-000000000002"; },
      (value) => { value.knowledgeSnapshot = ["00000000-0000-4000-8000-000000000002"]; },
      (value) => { value.inputContract.fields[0].required = false; },
      (value) => { value.inputContract.fields[0].type = "number"; },
      (value) => { value.outputContract!.fields[0].sourcePath = ["other"]; },
      (value) => { value.workflowSnapshot.nodes.read.tool!.inputSchema = { type: "object" }; },
      (value) => { value.designAudit.issueCount += 1; },
      (value) => { value.requirementCoverage = { changed: true }; },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(generated); mutate(changed);
      expect(changed.workflowFingerprint).toBe(generated.workflowFingerprint);
      expect(isDuplicatePublishedVersion({ status: "production", manifest: persisted }, "production", changed)).toBe(false);
    }
  });

  it("明确空值不是省略字段，数组顺序和完整字段差异仍阻止复用", () => {
    const persisted = { ...manifest, fields: [{ name: "first" }, { name: "second" }] };
    expect(isDuplicatePublishedVersion({ status: "production", manifest: persisted }, "production", { ...persisted, extra: null })).toBe(false);
    expect(isDuplicatePublishedVersion({ status: "production", manifest: persisted }, "production", { ...persisted, fields: [...persisted.fields].reverse() })).toBe(false);
  });

  it("不能转成持久 JSON 的清单不复用，也不抛出原始错误", () => {
    const circular: Record<string, unknown> = { ...manifest }; circular.self = circular;
    expect(isDuplicatePublishedVersion({ status: "production", manifest }, "production", circular)).toBe(false);
    expect(isDuplicatePublishedVersion({ status: "production", manifest }, "production", { ...manifest, invalid: BigInt(1) })).toBe(false);
    expect(isDuplicatePublishedVersion({ status: "production", manifest: undefined }, "production", undefined)).toBe(false);
  });
});
