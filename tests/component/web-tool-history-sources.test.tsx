import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { WebToolSources } from "@/features/web-tools/WebToolSources";

const io = vi.hoisted(() => ({ targets: vi.fn(), source: vi.fn(), start: vi.fn() }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: io.targets }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: io.source }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: io.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (read: () => Promise<unknown>) => read() }));

const agentId = "00000000-0000-4000-8000-000000000901";
const historicalId = "abcdef02-abcd-4abc-8abc-abcdefabcdef";
const currentId = "00000000-0000-4000-8000-000000000903";
const historical = AgentTargetOption.parse({ agentId, agentName: "材料核对助手", versionId: historicalId, version: 3,
  inputContract: { fields: [{ name: "old", label: "清单缓存名称", type: "string", required: true }] }, outputContract: { fields: [] } });
const current = AgentTargetOption.parse({ ...historical, versionId: currentId, version: 4,
  inputContract: { fields: [{ name: "new", label: "新版材料", type: "string", required: true }] } });
const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "historical-source",
  workflowSnapshot: { id: "history", rootAgent: { id: agentId, name: historical.agentName, role: "核对材料" }, memoryPolicy: { taskContext: true, longTerm: false },
    variables: [{ name: "old", type: "string", scope: "run", description: "历史来源的独立填写说明" }],
    nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "结束", type: "end" } } },
  inputContract: { fields: [{ name: "old", label: "历史业务材料", type: "string", required: true }] },
  outputContract: { fields: [{ path: "answer", label: "历史业务结论", required: true }] },
  resourceSelection: { model: { modelId: "test", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 } });
const source = { agentName: historical.agentName, version: 3, status: "retired", manifest, createdAt: new Date("2026-10-10T00:00:00Z") };

beforeEach(() => { vi.clearAllMocks(); io.targets.mockResolvedValue([current, historical]); io.source.mockResolvedValue(source); });

describe("网页工具明确选择的历史版本来源", () => {
  it("合法大写UUID只在内部标准化，仍精确读取同一旧版本而非不匹配后回退", async () => {
    render(await WebToolSources({ navigation: { versionId: historicalId.toUpperCase() }, invalid: false }));
    expect(io.targets).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, "", [historicalId]);
    expect(io.source).toHaveBeenCalledExactlyOnceWith(agentId, historicalId, DEMO_WORKSPACE_ID);
    expect(screen.getByRole("combobox", { name: "用于核对的助手版本" })).toHaveValue(historicalId);
    expect(screen.getByRole("textbox", { name: "历史业务材料（必填）" })).toBeVisible();
    expect(io.start).not.toHaveBeenCalled();
  });
  it("只有导航明确且合法的唯一版本进入查询，历史字段和说明来自同一个实际来源", async () => {
    const { container } = render(await WebToolSources({ navigation: { versionId: historicalId }, invalid: false }));
    expect(io.targets).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, "", [historicalId]);
    expect(io.source).toHaveBeenCalledExactlyOnceWith(agentId, historicalId, DEMO_WORKSPACE_ID);
    expect(screen.getByRole("textbox", { name: "历史业务材料（必填）" })).toHaveAccessibleDescription("文字，可以分行填写 历史来源的独立填写说明");
    expect(within(screen.getByRole("region", { name: "交付字段" })).getByText("历史业务结论")).toBeVisible();
    expect(screen.getByRole("option", { name: /版本 3 · 所选历史版本/ })).toBeEnabled();
    expect(screen.getByRole("option", { name: /版本 4 · 当前正式版本/ })).toBeEnabled();
    expect(screen.getByRole("region", { name: "内部试运行" })).toHaveTextContent("选定的版本 3");
    expect(screen.getByRole("link", { name: "只读核对这个版本的流程" })).toHaveAttribute("href", `/agents/${agentId}/versions/${historicalId}?source=web-tools`);
    expect(container.textContent).not.toContain("清单缓存名称"); expect(container.textContent).not.toContain("新版材料");
    expect(container.textContent).toContain("不会恢复为正式版本或改用新版"); expect(io.start).not.toHaveBeenCalled();
  });

  it("重新读取仍保留明确历史选择，不将清单第一项当替代来源", async () => {
    const view = render(await WebToolSources({ navigation: { versionId: historicalId }, invalid: false }));
    view.rerender(await WebToolSources({ navigation: { versionId: historicalId }, invalid: false }));
    expect(io.targets.mock.calls.map((call) => call[2])).toEqual([[historicalId], [historicalId]]);
    expect(io.source.mock.calls.map((call) => call.slice(0, 2))).toEqual([[agentId, historicalId], [agentId, historicalId]]);
    expect(screen.getByRole("combobox", { name: "用于核对的助手版本" })).toHaveValue(historicalId);
    expect(io.start).not.toHaveBeenCalled();
  });

  it.each(["candidate", "superseded", "private-unknown-status", "failure", "missing", "wrong-number", "invalid-manifest"])("%s 不能冒充可运行历史来源，也不自动换新版", async (condition) => {
    if (condition === "failure") io.source.mockRejectedValueOnce(new Error("private-source-credential"));
    else io.source.mockResolvedValueOnce(condition === "missing" ? null : { ...source,
      status: ["candidate", "superseded", "private-unknown-status"].includes(condition) ? condition : "retired",
      version: condition === "wrong-number" ? 99 : 3, manifest: condition === "invalid-manifest" ? { private: "private-manifest-value" } : manifest });
    const { container } = render(await WebToolSources({ navigation: { versionId: historicalId }, invalid: false }));
    expect(io.source).toHaveBeenCalledExactlyOnceWith(agentId, historicalId, DEMO_WORKSPACE_ID);
    expect(screen.getByRole("combobox", { name: "用于核对的助手版本" })).toHaveValue(historicalId);
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
    expect(screen.queryByText("所选历史版本的已保存来源")).not.toBeInTheDocument();
    expect(screen.queryByText("历史来源的独立填写说明")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /版本 3 · 来源尚无法核对/ })).toBeDisabled();
    expect(container.textContent).not.toMatch(/private-source-credential|private-manifest-value|private-unknown-status/);
    expect(io.start).not.toHaveBeenCalled();
  });

  it.each([{ navigation: {}, invalid: true }, { navigation: { versionId: "not-a-uuid" }, invalid: false },
    { navigation: { versionId: [historicalId, currentId] }, invalid: false }])("无效或重复导航不将任何原值传给历史查询", async (invalid) => {
    render(await WebToolSources(invalid as unknown as Parameters<typeof WebToolSources>[0]));
    expect(io.targets).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, "", []);
    expect(io.source).not.toHaveBeenCalled(); expect(io.start).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
  });

  it("未知、其他工作区或已停用助手的明确选择不在有效清单时不能降级到新版", async () => {
    io.targets.mockResolvedValueOnce([current]);
    render(await WebToolSources({ navigation: { versionId: historicalId }, invalid: false }));
    expect(io.source).not.toHaveBeenCalled(); expect(screen.getByRole("heading", { name: "找不到所选版本" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument(); expect(io.start).not.toHaveBeenCalled();
  });

  it("重复版本清单不能用于字段或试运行，不猜测归属", async () => {
    io.targets.mockResolvedValueOnce([historical, historical]);
    render(await WebToolSources({ navigation: { versionId: historicalId }, invalid: false }));
    expect(screen.getByRole("heading", { name: "版本来源清单暂时无法读取" })).toBeVisible();
    expect(io.source).not.toHaveBeenCalled(); expect(io.start).not.toHaveBeenCalled();
  });
});
