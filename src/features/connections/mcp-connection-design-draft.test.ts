import { describe, expect, it } from "vitest";
import { McpConnectionDesignDraftSchema, checkMcpConnectionDesign, createMcpConnectionDesignDraft,
  isMcpDesignAddress, mcpDesignCapabilityLabels, resemblesMcpAccessSecret } from "./mcp-connection-design-draft";

function connection() {
  return { ...createMcpConnectionDesignDraft(), name: "业务外部服务", address: "https://tools.example.test/bridge", authentication: "none" as const };
}
function boundary() {
  return { ...connection(), boundaryEnabled: true, displayName: "查询业务记录", behavior: "从业务系统读取记录，不写入；成功回执为返回的记录。",
    capabilityLabels: "读取业务记录", operation: "read" as const, risk: "low" as const, automation: "approval_required" as const };
}

describe("外部连接本页设计校验", () => {
  it("只校验启用方案的长度约束，关闭后保留原填写，重新启用仍报明确错误", () => {
    const draft = { ...connection(), credentialReference: "C".repeat(201), accountReference: "A".repeat(201), headerName: "H".repeat(201),
      displayName: "N".repeat(201), behavior: "说".repeat(4001), capabilityLabels: "标".repeat(10001) };
    const before = JSON.stringify(draft);
    expect(checkMcpConnectionDesign(draft)).toEqual([]);
    expect(checkMcpConnectionDesign({ ...draft, authentication: "credential" }).map((issue) => issue.field)).toEqual(["credentialReference", "headerName"]);
    expect(checkMcpConnectionDesign({ ...draft, authentication: "account" }).map((issue) => issue.field)).toEqual(["accountReference"]);
    expect(checkMcpConnectionDesign({ ...draft, boundaryEnabled: true }).map((issue) => issue.field)).toEqual(["displayName", "behavior", "capabilityLabels", "operation", "risk", "automation"]);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("初始空白且只有固定传输，不生成默认凭据、账号或核验声明", () => {
    const draft = createMcpConnectionDesignDraft();
    expect(draft).toEqual(createMcpConnectionDesignDraft());
    expect(draft).toMatchObject({ name: "", address: "", authentication: "", credentialReference: "", accountReference: "",
      headerName: "", boundaryEnabled: false, capabilityLabels: "", risk: "", automation: "", transport: "streamable-http" });
    expect(checkMcpConnectionDesign(draft)).toEqual([
      { field: "name", message: "请填写连接名称" },
      { field: "address", message: "请填写服务地址" },
      { field: "authentication", message: "请选择认证方式设计" },
    ]);
  });

  it.each(["https://tools.example.test/bridge", "http://localhost:3300/bridge", "https://例子.测试/服务"])("接受本页网页地址 %s", (address) => {
    expect(isMcpDesignAddress(address)).toBe(true);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), address }).success).toBe(true);
  });
  it.each(["", "/bridge", "ftp://example.test", "javascript:alert(1)", "https://user:password@example.test",
    "https://example.test?access_token=not-a-real-secret", "https://example.test?region=test", "https://example.test#part",
    "https://example.test?", "https://example.test#", "https://example.test/a b"])("拒绝本页非保护地址 %s", (address) => {
    expect(isMcpDesignAddress(address)).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), address }).success).toBe(false);
  });

  it("固定当前传输，不能把服务器登记格式或其他传输冒充本地设计", () => {
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), transport: "stdio" }).success).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), transport: "sse" }).success).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), workspaceId: "not-a-local-design-field" }).success).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), token: "not-a-credential-field" }).success).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), verified: true }).success).toBe(false);
  });

  it("名称 200 字完整接受，名称、地址与说明边界不截断代替错误", () => {
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), name: "A".repeat(200) }).success).toBe(true);
    expect(checkMcpConnectionDesign({ ...connection(), name: "A".repeat(201) })).toContainEqual({ field: "name", message: "连接名称不能超过 200 字" });
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), address: "https://example.test/" + "a".repeat(2048) }).success).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...boundary(), behavior: "说".repeat(4000) }).success).toBe(true);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...boundary(), behavior: "说".repeat(4001) }).success).toBe(false);
  });

  it("凭据引用与请求头名称分别必填，引用不等于凭据存在或授权完成", () => {
    expect(checkMcpConnectionDesign({ ...connection(), authentication: "credential" })).toEqual([
      { field: "credentialReference", message: "请填写服务端凭据的名称引用，不填写密钥" },
      { field: "headerName", message: "请填写合法认证请求头名称；不能包含空格、冒号或换行" },
    ]);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), authentication: "credential", credentialReference: "TEAM_SERVICE_CREDENTIAL", headerName: "Authorization" }).success).toBe(true);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), authentication: "credential", credentialReference: "TEAM_SERVICE_CREDENTIAL", headerName: "Authorization: injected" }).success).toBe(false);
    expect(checkMcpConnectionDesign({ ...connection(), authentication: "account" })).toContainEqual({
      field: "accountReference", message: "请填写已有账号授权的名称引用；本页不能验证该授权是否存在",
    });
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), authentication: "account", accountReference: "团队已有授权名称" }).success).toBe(true);
  });

  it.each(["Bearer not-a-real-secret", "Basic not-a-real-secret", "pat_local-test", "github_pat_local-test", "ghp_local-test", "sk-local-test", "figd_local-test", "eyJlocal-test"])("疑似访问值 %s 不能充当名称引用", (value) => {
    expect(resemblesMcpAccessSecret(value)).toBe(true);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), credentialReference: value }).success).toBe(false);
    expect(McpConnectionDesignDraftSchema.safeParse({ ...connection(), accountReference: value }).success).toBe(false);
  });

  it("只有选择业务边界后才要求业务字段，不把未填写设计当已核验能力", () => {
    expect(checkMcpConnectionDesign(connection())).toEqual([]);
    expect(checkMcpConnectionDesign({ ...connection(), boundaryEnabled: true }).map((issue) => issue.field)).toEqual([
      "displayName", "behavior", "capabilityLabels", "operation", "risk", "automation",
    ]);
    expect(checkMcpConnectionDesign(boundary())).toEqual([]);
  });

  it("待核验标签解析保留完整文字，空、重复、超多或单项超长均拒绝", () => {
    expect(mcpDesignCapabilityLabels("读取业务记录\n 写入业务记录，发送消息")).toEqual(["读取业务记录", "写入业务记录", "发送消息"]);
    for (const capabilityLabels of ["", "读取记录\n读取记录", "A".repeat(201), Array.from({ length: 51 }, (_, index) => "标签" + index).join("\n")]) {
      expect(McpConnectionDesignDraftSchema.safeParse({ ...boundary(), capabilityLabels }).success).toBe(false);
    }
    expect(McpConnectionDesignDraftSchema.safeParse({ ...boundary(), capabilityLabels: "A".repeat(200) }).success).toBe(true);
  });

  it.each(["read", "action"] as const)("读写设计 %s 的高风险方案不能自动，人工确认和停用仍只为设计", (operation) => {
    expect(checkMcpConnectionDesign({ ...boundary(), operation, risk: "high", automation: "automatic_allowed" })).toContainEqual({
      field: "automation", message: "高风险方案不能设为自动调用，请选择人工确认或停用",
    });
    for (const automation of ["approval_required", "disabled"] as const) {
      expect(checkMcpConnectionDesign({ ...boundary(), operation, risk: "high", automation })).toEqual([]);
    }
  });

  it("校验不修改原填写，归一化结果不是服务器保存", () => {
    const draft = { ...connection(), name: "  名称  " };
    const before = JSON.stringify(draft);
    expect(checkMcpConnectionDesign(draft)).toEqual([]);
    expect(JSON.stringify(draft)).toBe(before);
    expect(McpConnectionDesignDraftSchema.parse(draft).name).toBe("名称");
  });
});
