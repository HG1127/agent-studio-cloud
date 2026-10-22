import { describe, expect, it } from "vitest";
import { WebToolDesignDraft, createWebToolDesignDraft, readWebToolDesignJson } from "./web-tool-design-draft";
import { WEB_TOOL_QUOTA_FIELDS, WEB_TOOL_QUOTA_PRESETS, applyWebToolQuotaPreset, findWebToolQuotaPreset } from "./web-tool-design-quota";

describe("网页工具草稿用量方案", () => {
  it.each([
    ["recommended", { maxPerHour: 20, maxPerDay: 100, maxConcurrent: 3, maxRuntimeSeconds: 180, maxCostUnits: 50 }],
    ["standard", { maxPerHour: 60, maxPerDay: 300, maxConcurrent: 5, maxRuntimeSeconds: 300, maxCostUnits: 80 }],
  ] as const)("%s 的五项数值与旧版实际可选方案一致", (id, values) => {
    const result = applyWebToolQuotaPreset({ ...createWebToolDesignDraft(), name: "使用方案", maxPerHour: 7 }, id);
    for (const { key } of WEB_TOOL_QUOTA_FIELDS) expect(result[key]).toBe(values[key]);
    expect(findWebToolQuotaPreset(result)?.id).toBe(id);
    expect(WebToolDesignDraft.safeParse(result).success).toBe(true);
    expect(readWebToolDesignJson(JSON.stringify(result))).toEqual({ ok: true, draft: result });
  });

  it.each(WEB_TOOL_QUOTA_FIELDS)("单独修改 $key 后识别为自定义，不留下过期方案标签", ({ key }) => {
    const draft = createWebToolDesignDraft();
    expect(findWebToolQuotaPreset(draft)?.id).toBe("recommended");
    expect(findWebToolQuotaPreset({ ...draft, [key]: draft[key] + 1 })).toBeUndefined();
  });

  it.each([NaN, Infinity, -Infinity, 0.5])("无效或不同数值 %s 不冒认预设", (value) => {
    expect(findWebToolQuotaPreset({ ...createWebToolDesignDraft(), maxPerHour: value })).toBeUndefined();
  });

  it("仅替换五项，保留其他设计、数组引用与原草稿", () => {
    const draft = Object.freeze({ ...createWebToolDesignDraft(), name: "保留的名称", description: "保留的说明",
      domains: "https://team.example.test", allowWriteScopes: "明确登记的权限", maxCostUnits: 12 });
    const before = JSON.stringify(draft);
    const result = applyWebToolQuotaPreset(draft, "standard");
    expect(result).toEqual({ ...draft, ...WEB_TOOL_QUOTA_PRESETS[1].values });
    expect(result.fields).toBe(draft.fields);
    expect(result.modules).toBe(draft.modules);
    expect(JSON.stringify(draft)).toBe(before);
    expect(result).not.toBe(draft);
  });

  it("重复应用相同数值不生成新草稿", () => {
    const draft = createWebToolDesignDraft();
    expect(applyWebToolQuotaPreset(draft, "recommended")).toBe(draft);
    const team = applyWebToolQuotaPreset(draft, "standard");
    expect(applyWebToolQuotaPreset(team, "standard")).toBe(team);
    expect(applyWebToolQuotaPreset(team, "recommended")).toEqual(draft);
  });
});
