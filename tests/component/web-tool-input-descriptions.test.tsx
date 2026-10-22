import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { WebToolSources } from "@/features/web-tools/WebToolSources";

const mocks = vi.hoisted(() => ({ targets: vi.fn(), source: vi.fn(), start: vi.fn() }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: mocks.targets }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.source }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));

const agentId = "00000000-0000-4000-8000-000000000171";
const versionId = "00000000-0000-4000-8000-000000000172";
const otherVersionId = "00000000-0000-4000-8000-000000000173";
const target = { agentId, versionId, agentName: "材料核对助手", version: 3,
  inputContract: { fields: [{ name: "material", label: "业务材料", type: "string", required: true }] }, outputContract: { fields: [] } };
const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "frozen",
  workflowSnapshot: { id: "description-source", rootAgent: { id: agentId, name: target.agentName, role: "核对业务材料" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: { start: { id: "start", type: "trigger", title: "开始", next: "done" }, done: { id: "done", type: "end", title: "结束" } },
    variables: [{ name: "material", type: "string", scope: "run", description: "该正式版本已保存的填写说明" },
      { name: "hidden", type: "string", scope: "private", description: "不能借用的其他范围说明" }] },
  inputContract: target.inputContract, resourceSelection: { model: { modelId: "test", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.targets.mockResolvedValue([target, { ...target, versionId: otherVersionId, version: 4 }]);
  mocks.source.mockResolvedValue({ agentName: target.agentName, version: 3, status: "production", manifest });
});

describe("网页工具的真实冻结填写说明", () => {
  it("按照所选版本和助手查询，不借用清单中其他版本或其他范围", async () => {
    mocks.source.mockResolvedValueOnce({ agentName: target.agentName, version: 4, status: "production", manifest });
    render(await WebToolSources({ navigation: { versionId: otherVersionId }, invalid: false }));
    expect(mocks.source).toHaveBeenCalledExactlyOnceWith(agentId, otherVersionId, DEMO_WORKSPACE_ID);
    expect(screen.getByRole("textbox", { name: "业务材料（必填）" })).toHaveAccessibleDescription("文字，可以分行填写 该正式版本已保存的填写说明");
    expect(screen.queryByText("不能借用的其他范围说明")).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["failure", "missing", "candidate", "unknown", "mismatched-number", "invalid-manifest"] as const)("%s 不伪造没有说明，保留字段并展示独立降级状态且不能新试运行", async (failure) => {
    if (failure === "failure") mocks.source.mockRejectedValueOnce(new Error("private-source-secret"));
    else mocks.source.mockResolvedValueOnce(failure === "missing" ? null : {
      agentName: target.agentName, version: failure === "mismatched-number" ? 99 : 3,
      status: failure === "candidate" ? "candidate" : failure === "unknown" ? "unknown-private-status" : "production",
      manifest: failure === "invalid-manifest" ? { invalid: true } : manifest,
    });
    const { container } = render(await WebToolSources({ navigation: { versionId }, invalid: false }));
    expect(screen.getByText(/不代表该版本没有说明/)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "业务材料（必填）" })).toBeEnabled();
    expect(screen.queryByText("该正式版本已保存的填写说明")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("private-source-secret");
    expect(container.textContent).not.toContain("unknown-private-status");
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "只读核对这个版本的流程" })).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("无效或不存在的选择不查询冻结说明，也不自动替换版本", async () => {
    const { rerender } = render(await WebToolSources({ navigation: {}, invalid: true }));
    expect(mocks.source).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "等待选择正式版本" })).toBeVisible();
    rerender(await WebToolSources({ navigation: { versionId: "00000000-0000-4000-8000-000000000199" }, invalid: false }));
    expect(mocks.source).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "找不到所选版本" })).toBeVisible();
  });
});
