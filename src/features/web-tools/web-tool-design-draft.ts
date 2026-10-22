import { z } from "zod";
import { AgentInputContract, AgentInputField } from "@/contracts/manifest";
import type { AgentTargetOption } from "@/contracts/agent";

export const WEB_TOOL_STEPS = ["基本信息", "输入项", "结果呈现", "访问与发布"] as const;
export const WEB_TOOL_LAYOUTS = [
  { value: "report", label: "报告型", description: "分段报告与要点清单" },
  { value: "scorecard", label: "评分卡", description: "指标与综合说明" },
  { value: "analysis", label: "分析建议", description: "核心发现与风险提示" },
  { value: "compact", label: "紧凑摘要", description: "简洁的单栏交付" },
] as const;
export const WEB_TOOL_MODULES = [
  { value: "ResultCard", label: "正文卡片" },
  { value: "ScoreCards", label: "评分卡片" },
  { value: "BulletList", label: "要点清单" },
  { value: "RiskCards", label: "风险提示" },
  { value: "MetricGrid", label: "指标网格" },
] as const;
export const WEB_TOOL_AUDIENCES = [
  { value: "internal_staff", label: "公司内部员工" },
  { value: "authenticated", label: "已登录用户" },
  { value: "domain_sites", label: "指定网站访客" },
  { value: "anonymous_all", label: "公开所有人" },
] as const;

const nameText = z.string().trim().min(1, "请填写名称").max(200, "名称不能超过 200 字");
const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const WebToolDesignField = AgentInputField.extend({
  id: z.string().min(1).max(200),
  label: nameText,
  rows: z.number().int().min(1).max(12),
  placeholder: z.string().max(2000),
  description: z.string().max(2000),
}).strict();
export type WebToolDesignField = z.infer<typeof WebToolDesignField>;
export const WebToolDesignModule = z.object({
  id: z.string().min(1).max(200),
  title: nameText,
  source: z.string().trim().min(1, "请填写结果来源字段").max(200),
  component: z.enum(["ResultCard", "ScoreCards", "BulletList", "RiskCards", "MetricGrid"]),
  enabled: z.boolean(),
  description: z.string().max(2000),
}).strict();
export type WebToolDesignModule = z.infer<typeof WebToolDesignModule>;

export function splitDesignLines(value: string) {
  return value.split(/[\n,，]/u).map((entry) => entry.trim()).filter(Boolean);
}

export function isDesignOrigin(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      && (url.pathname === "/" || url.pathname === "") && !url.search && !url.hash;
  } catch { return false; }
}

export const WebToolDesignDraft = z.object({
  name: nameText,
  slug: z.string().max(200).refine((value) => value === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value), "访问路径只可使用小写字母、数字和短横线"),
  description: z.string().max(2000),
  targetAudience: z.string().max(200),
  versionId: z.union([z.literal(""), z.string().uuid()]),
  fields: z.array(WebToolDesignField).max(100),
  preset: z.enum(["report", "scorecard", "analysis", "compact"]),
  modules: z.array(WebToolDesignModule).max(100),
  audienceType: z.enum(["internal_staff", "authenticated", "domain_sites", "anonymous_all"]),
  accessMode: z.enum(["credential", "anonymous"]),
  domains: z.string().max(10000),
  maxPerHour: positiveInteger,
  maxPerDay: positiveInteger,
  maxConcurrent: positiveInteger,
  maxRuntimeSeconds: positiveInteger,
  maxCostUnits: z.number().positive().max(Number.MAX_SAFE_INTEGER),
  allowWriteScopes: z.string().max(10000),
}).strict().superRefine((draft, ctx) => {
  const contract = AgentInputContract.safeParse({ fields: draft.fields });
  if (!contract.success) for (const issue of contract.error.issues) ctx.addIssue({
    code: "custom", path: issue.path, message: "输入字段标识不合法或重复，请核对字段设置",
  });
  for (const collection of ["fields", "modules"] as const) {
    const ids = new Set<string>();
    draft[collection].forEach((entry, index) => {
      if (ids.has(entry.id)) ctx.addIssue({ code: "custom", path: [collection, index], message: "同一区域的项目不能重复" });
      ids.add(entry.id);
    });
  }
  const origins = splitDesignLines(draft.domains);
  if (origins.some((entry) => !isDesignOrigin(entry))) ctx.addIssue({
    code: "custom", path: ["domains"], message: "网站地址须为完整的网站来源，不含路径、查询、片段或账号密码",
  });
  if (draft.audienceType === "domain_sites" && origins.length === 0) ctx.addIssue({
    code: "custom", path: ["domains"], message: "请至少填写一个指定网站",
  });
  if (draft.maxPerDay < draft.maxPerHour) ctx.addIssue({
    code: "custom", path: ["maxPerDay"], message: "每天上限不能小于每小时上限",
  });
});
export type WebToolDesignDraft = z.infer<typeof WebToolDesignDraft>;

export function createWebToolDesignDraft(): WebToolDesignDraft {
  return { name: "", slug: "", description: "", targetAudience: "", versionId: "", fields: [],
    preset: "report", modules: [], audienceType: "internal_staff", accessMode: "credential", domains: "",
    maxPerHour: 20, maxPerDay: 100, maxConcurrent: 3, maxRuntimeSeconds: 180, maxCostUnits: 50, allowWriteScopes: "" };
}

export function designFieldsFromTarget(target: AgentTargetOption): WebToolDesignField[] {
  return target.inputContract.fields.map((field, index) => ({ ...field, id: "formal-input-" + index,
    label: field.label || "输入项 " + (index + 1), rows: field.type === "string" ? 3 : 1, placeholder: "", description: "" }));
}

export function reorderDesignItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const next = index + delta;
  if (index < 0 || index >= items.length || next < 0 || next >= items.length) return items;
  const reordered = [...items];
  [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
  return reordered;
}

export function checkWebToolDesign(draft: WebToolDesignDraft, targets: AgentTargetOption[] | null) {
  const parsed = WebToolDesignDraft.safeParse(draft);
  const issues: { step: number; message: string; source?: boolean; path?: PropertyKey[] }[] = [];
  if (!parsed.success) for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    const step = field === "fields" ? 1 : field === "modules" || field === "preset" ? 2
      : ["audienceType", "accessMode", "domains", "maxPerHour", "maxPerDay", "maxConcurrent", "maxRuntimeSeconds", "maxCostUnits", "allowWriteScopes"].includes(String(field)) ? 3 : 0;
    const message = field === "name" ? "请填写不超过 200 字的工具名称"
      : field === "fields" ? "请核对输入项名称、字段标识、类型与重复项"
      : field === "modules" ? "请核对结果模块名称、来源字段与重复项"
      : field === "slug" ? "访问路径只可使用小写字母、数字和短横线"
      : String(field).startsWith("max") ? (field === "maxPerDay" && draft.maxPerDay < draft.maxPerHour ? "每天上限不能小于每小时上限" : "使用上限须为有效正数，次数、并发与时长须为整数")
      : field === "domains" ? issue.message : "请核对本步骤的填写长度和格式";
    if (!issues.some((entry) => entry.step === step && entry.message === message)) issues.push({ step, message, path: issue.path });
  }
  if (draft.versionId && !targets?.some((target) => target.versionId === draft.versionId)) issues.push({
    step: 0, source: true, path: ["versionId"], message: targets === null ? "正式助手读取失败，当前无法核对所选版本；设计填写已保留" : "所选正式版本已不在当前列表中，请重新选择；设计填写已保留",
  });
  return issues.sort((a, b) => a.step - b.step);
}

export function readWebToolDesignJson(value: string) {
  if (new TextEncoder().encode(value).byteLength > 100 * 1024) return { ok: false as const, message: "专业配置不能超过 100 千字节" };
  try {
    const parsed = WebToolDesignDraft.safeParse(JSON.parse(value));
    return parsed.success ? { ok: true as const, draft: parsed.data }
      : { ok: false as const, message: "配置格式或填写不合法，请核对名称、字段、模块、网站与使用上限；原草稿未变" };
  } catch { return { ok: false as const, message: "配置不是有效的结构化文本；原草稿未变" }; }
}
