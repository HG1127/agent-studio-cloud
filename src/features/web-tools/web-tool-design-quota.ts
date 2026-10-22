import type { WebToolDesignDraft } from "./web-tool-design-draft";

export const WEB_TOOL_QUOTA_FIELDS = [
  { key: "maxPerHour", label: "每小时次数上限" },
  { key: "maxPerDay", label: "每天次数上限" },
  { key: "maxConcurrent", label: "最大并发数" },
  { key: "maxRuntimeSeconds", label: "最长运行时间（秒）" },
  { key: "maxCostUnits", label: "成本额度上限" },
] as const;

export const WEB_TOOL_QUOTA_PRESETS = [
  { id: "recommended", label: "常规使用", values: {
    maxPerHour: 20, maxPerDay: 100, maxConcurrent: 3, maxRuntimeSeconds: 180, maxCostUnits: 50,
  } },
  { id: "standard", label: "团队协同", values: {
    maxPerHour: 60, maxPerDay: 300, maxConcurrent: 5, maxRuntimeSeconds: 300, maxCostUnits: 80,
  } },
] as const;

type QuotaValues = Pick<WebToolDesignDraft, typeof WEB_TOOL_QUOTA_FIELDS[number]["key"]>;

export function findWebToolQuotaPreset(draft: QuotaValues) {
  return WEB_TOOL_QUOTA_PRESETS.find((preset) => WEB_TOOL_QUOTA_FIELDS.every(({ key }) => draft[key] === preset.values[key]));
}

export function applyWebToolQuotaPreset(draft: WebToolDesignDraft, presetId: typeof WEB_TOOL_QUOTA_PRESETS[number]["id"]): WebToolDesignDraft {
  const preset = WEB_TOOL_QUOTA_PRESETS.find((item) => item.id === presetId);
  if (!preset || findWebToolQuotaPreset(draft)?.id === preset.id) return draft;
  return { ...draft, ...preset.values };
}
