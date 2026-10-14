import { z } from "zod";

export const MCP_DESIGN_AUTHENTICATION = [
  { value: "none", label: "不需要认证（设计方案）" },
  { value: "credential", label: "服务端凭据名称引用" },
  { value: "account", label: "已有账号授权名称引用" },
] as const;
export const MCP_DESIGN_OPERATIONS = [
  { value: "read", label: "只读取，不改变数据" },
  { value: "action", label: "执行操作或写入数据" },
] as const;
export const MCP_DESIGN_RISKS = [
  { value: "low", label: "低风险" }, { value: "medium", label: "中风险" }, { value: "high", label: "高风险" },
] as const;
export const MCP_DESIGN_AUTOMATION = [
  { value: "automatic_allowed", label: "按已发布流程自动调用（方案）" },
  { value: "approval_required", label: "每次由员工确认（方案）" },
  { value: "disabled", label: "停用（方案）" },
] as const;

export function resemblesMcpAccessSecret(value: string) {
  return /^(?:Bearer(?:\s|$)|Basic(?:\s|$)|pat_|gh[pousr]_|github_pat_|sk-|figd_|eyJ)/iu.test(value.trim());
}

export function isMcpDesignAddress(value: string) {
  if (/\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname)
      && !url.username && !url.password && !value.includes("?") && !value.includes("#");
  } catch { return false; }
}

export function mcpDesignCapabilityLabels(value: string) {
  return value.split(/[\n,，]/u).map((item) => item.trim()).filter(Boolean);
}

const optionalReference = z.string().trim()
  .refine((value) => !resemblesMcpAccessSecret(value), "这里只填写名称引用，不接受访问密钥或授权值");

export const McpConnectionDesignDraftSchema = z.object({
  name: z.string().trim().min(1, "请填写连接名称").max(200, "连接名称不能超过 200 字"),
  address: z.string().trim().min(1, "请填写服务地址").max(2048, "服务地址不能超过 2048 字")
    .refine(isMcpDesignAddress, "本页服务地址须为完整网页地址，不含账号密码、查询参数或片段"),
  transport: z.literal("streamable-http"),
  authentication: z.enum(["", "none", "credential", "account"]).refine((value): boolean => value !== "", "请选择认证方式设计"),
  credentialReference: optionalReference,
  accountReference: optionalReference,
  headerName: z.string().trim(),
  boundaryEnabled: z.boolean(),
  displayName: z.string().trim(),
  behavior: z.string().trim(),
  capabilityLabels: z.string(),
  operation: z.enum(["", "read", "action"]),
  risk: z.enum(["", "low", "medium", "high"]),
  automation: z.enum(["", "automatic_allowed", "approval_required", "disabled"]),
}).strict().superRefine((draft, context) => {
  if (draft.authentication === "credential") {
    if (!draft.credentialReference) context.addIssue({ code: "custom", path: ["credentialReference"], message: "请填写服务端凭据的名称引用，不填写密钥" });
    if (draft.credentialReference.length > 200) context.addIssue({ code: "custom", path: ["credentialReference"], message: "引用名称不能超过 200 字" });
    if (draft.headerName.length > 200) context.addIssue({ code: "custom", path: ["headerName"], message: "认证请求头名称不能超过 200 字" });
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(draft.headerName)) context.addIssue({
      code: "custom", path: ["headerName"], message: "请填写合法认证请求头名称；不能包含空格、冒号或换行",
    });
  }
  if (draft.authentication === "account") {
    if (!draft.accountReference) context.addIssue({ code: "custom", path: ["accountReference"], message: "请填写已有账号授权的名称引用；本页不能验证该授权是否存在" });
    if (draft.accountReference.length > 200) context.addIssue({ code: "custom", path: ["accountReference"], message: "引用名称不能超过 200 字" });
  }
  if (!draft.boundaryEnabled) return;
  if (!draft.displayName) context.addIssue({ code: "custom", path: ["displayName"], message: "请填写员工看到的工具名称" });
  if (draft.displayName.length > 200) context.addIssue({ code: "custom", path: ["displayName"], message: "业务名称不能超过 200 字" });
  if (!draft.behavior) context.addIssue({ code: "custom", path: ["behavior"], message: "请说明实际行为、数据来源、写入对象与成功回执" });
  if (draft.behavior.length > 4000) context.addIssue({ code: "custom", path: ["behavior"], message: "实际行为说明不能超过 4000 字" });
  if (draft.capabilityLabels.length > 10000) context.addIssue({ code: "custom", path: ["capabilityLabels"], message: "待核验标签不能超过 10000 字" });
  const labels = mcpDesignCapabilityLabels(draft.capabilityLabels);
  if (labels.length === 0 || labels.length > 50 || labels.some((label) => label.length > 200) || new Set(labels).size !== labels.length) context.addIssue({
    code: "custom", path: ["capabilityLabels"], message: "请填写 1 至 50 项待核验能力标签，每项不超过 200 字且不能重复",
  });
  if (!draft.operation) context.addIssue({ code: "custom", path: ["operation"], message: "请选择读写类型设计" });
  if (!draft.risk) context.addIssue({ code: "custom", path: ["risk"], message: "请选择风险等级设计" });
  if (!draft.automation) context.addIssue({ code: "custom", path: ["automation"], message: "请选择运行策略设计" });
  if (draft.risk === "high" && draft.automation === "automatic_allowed") context.addIssue({
    code: "custom", path: ["automation"], message: "高风险方案不能设为自动调用，请选择人工确认或停用",
  });
});
export type McpConnectionDesignDraft = z.infer<typeof McpConnectionDesignDraftSchema>;

export const McpConnectionDesignIssue = z.object({ field: z.string(), message: z.string() });
export type McpConnectionDesignIssue = z.infer<typeof McpConnectionDesignIssue>;

export function createMcpConnectionDesignDraft(): McpConnectionDesignDraft {
  return { name: "", address: "", transport: "streamable-http", authentication: "", credentialReference: "",
    accountReference: "", headerName: "", boundaryEnabled: false, displayName: "", behavior: "",
    capabilityLabels: "", operation: "", risk: "", automation: "" };
}

export function checkMcpConnectionDesign(draft: McpConnectionDesignDraft): McpConnectionDesignIssue[] {
  const parsed = McpConnectionDesignDraftSchema.safeParse(draft);
  if (parsed.success) return [];
  const issues: McpConnectionDesignIssue[] = [];
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "name");
    if (!issues.some((previous) => previous.field === field)) issues.push({ field, message: issue.message });
  }
  return issues;
}
