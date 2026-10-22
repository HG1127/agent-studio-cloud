import { cloneElement, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { RunView } from "@/contracts/run";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import WebToolsPage from "@/app/(console)/web-tools/page";
import { WebToolSources } from "@/features/web-tools/WebToolSources";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { webToolRunHref } from "@/features/web-tools/web-tool-navigation";
import { webToolSourceRun, webToolSourceSteps } from "../fixtures/web-tool-result-source";

const io = vi.hoisted(() => ({ targets: vi.fn(), source: vi.fn(), run: vi.fn(), steps: vi.fn(), start: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/server/queries/agents", () => ({ listAgentTargets: io.targets }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: io.source }));
vi.mock("@/server/queries/runs", () => ({ getRunView: io.run, listRunSteps: io.steps }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: io.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: io.refresh, push: io.push }) }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (read: () => Promise<unknown>) => read() }));

const historicalId = webToolSourceRun.versionId!;
const currentId = "00000000-0000-4000-8000-000000000921";
const requestId = "00000000-0000-4000-8000-000000000922";
const target = AgentTargetOption.parse({ agentId: webToolSourceRun.agentId, agentName: webToolSourceRun.agentName,
  versionId: historicalId, version: webToolSourceRun.version!, inputContract: { fields: [{ name: "material", label: "历史材料", type: "string", required: true }] },
  outputContract: { fields: [{ path: "answer", label: "历史结论", required: true }] } });
const current = AgentTargetOption.parse({ ...target, versionId: currentId, version: target.version + 1,
  inputContract: { fields: [{ name: "newMaterial", label: "新版材料", type: "string", required: true }] } });
const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "history-composition",
  workflowSnapshot: { id: "saved-history", rootAgent: { id: target.agentId, name: target.agentName, role: "核对材料" }, memoryPolicy: { taskContext: true, longTerm: false },
    variables: [{ name: "material", type: "string", scope: "run", description: "只属于历史版本的填写说明" }],
    nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "结束", type: "end" } } },
  inputContract: target.inputContract, outputContract: target.outputContract,
  resourceSelection: { model: { modelId: "test", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 } });
const source = { agentName: target.agentName, version: target.version, status: "retired", manifest, createdAt: new Date("2026-10-10T00:00:00Z") };

async function resolveServerLeaves(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerLeaves));
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (node.type === WebToolSources) return WebToolSources(node.props as unknown as Parameters<typeof WebToolSources>[0]);
  if (node.type === WebToolTrialResult) return WebToolTrialResult(node.props as unknown as Parameters<typeof WebToolTrialResult>[0]);
  return cloneElement(node, undefined, await resolveServerLeaves(node.props.children));
}
async function page(version = historicalId, run = webToolSourceRun.id) {
  return resolveServerLeaves(await WebToolsPage({ searchParams: Promise.resolve({ version, trial: run }) }));
}

beforeEach(() => {
  vi.clearAllMocks(); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  io.targets.mockResolvedValue([current, target]); io.source.mockResolvedValue(source);
  io.run.mockResolvedValue(webToolSourceRun); io.steps.mockResolvedValue(webToolSourceSteps);
  io.start.mockResolvedValue({ ok: false, error: "本次服务端拒绝新任务" });
});
afterEach(() => vi.restoreAllMocks());

describe("真实网页父页的历史来源与保存结果组合", () => {
  it("大写合法导航在实际父页内核对同一UUID，不把同版本报成错配", async () => {
    const id = "abcdef04-abcd-4abc-8abc-abcdefabcdef";
    io.targets.mockResolvedValueOnce([current, { ...target, versionId: id }]);
    io.run.mockResolvedValueOnce(RunView.parse({ ...webToolSourceRun, versionId: id }));
    render(await page(id.toUpperCase()));
    expect(io.targets).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, "", [id]);
    expect(io.source.mock.calls.every((call) => call[1] === id)).toBe(true);
    expect(within(screen.getByRole("region", { name: "内部运行结果" })).queryByText(/本页核对的是版本/)).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "用于核对的助手版本" })).toHaveValue(id);
    expect(io.start).not.toHaveBeenCalled();
  });
  it("旧UUID重新打开及读取保留历史字段说明，保存结果仍按实际运行契约，读取不写业务", async () => {
    const view = render(await page());
    expect(io.targets).toHaveBeenCalledExactlyOnceWith(DEMO_WORKSPACE_ID, "", [historicalId]);
    expect(screen.getByRole("region", { name: "核对所选历史版本" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "历史材料（必填）" })).toHaveAccessibleDescription("文字，可以分行填写 只属于历史版本的填写说明");
    const saved = screen.getByRole("region", { name: "内部运行结果" });
    expect(within(saved).getByText("核对后的业务内容")).toBeVisible();
    expect(saved).toHaveTextContent("核对来源是已保存的历史版本");
    expect(within(saved).queryByRole("heading", { name: "历史结论" })).not.toBeInTheDocument();
    expect(within(saved).getByRole("link", { name: "查看本次任务与执行证据" })).toHaveAttribute("href", webToolRunHref(historicalId, webToolSourceRun.id));
    expect(within(saved).getByRole("link", { name: "移除本次关联" })).toHaveAttribute("href", `/web-tools?version=${historicalId}`);
    fireEvent.click(within(saved).getByRole("button", { name: "重新读取状态" }));
    expect(io.refresh).toHaveBeenCalledOnce(); view.rerender(await page());
    expect(io.targets.mock.calls.map((call) => call[2])).toEqual([[historicalId], [historicalId]]);
    expect(screen.getByRole("combobox", { name: "用于核对的助手版本" })).toHaveValue(historicalId);
    expect(io.start).not.toHaveBeenCalled();
  });

  it("历史来源手动确认只提交旧UUID及本次填写，不借保存输入或新版，结果关联不被修改", async () => {
    const user = userEvent.setup(); render(await page());
    const input = screen.getByRole("textbox", { name: "历史材料（必填）" });
    await user.type(input, "本次历史试填");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    const dialog = screen.getByRole("dialog", { name: "确认创建真实试运行？" });
    expect(dialog).toHaveTextContent(`版本 ${target.version}`); expect(io.start).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "确认并创建任务" }));
    expect(io.start).toHaveBeenCalledExactlyOnceWith({ agentId: target.agentId, versionId: historicalId, requestId, input: { material: "本次历史试填" } });
    expect(input).toHaveValue("本次历史试填"); expect(input).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("本次服务端拒绝新任务");
    expect(within(screen.getByRole("region", { name: "内部运行结果" })).getByText("核对后的业务内容")).toBeVisible();
    expect(io.push).not.toHaveBeenCalled();
  });

  it("停用助手不在有效来源清单，仍独立保留已核归属的历史结果，不开放新任务", async () => {
    io.targets.mockResolvedValueOnce([current]); io.run.mockResolvedValueOnce(RunView.parse({ ...webToolSourceRun, agentArchived: true }));
    render(await page());
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "内部运行结果" })).toHaveTextContent("这位助手已停用");
    expect(screen.getByText("核对后的业务内容")).toBeVisible(); expect(io.start).not.toHaveBeenCalled();
  });

  it("来源清单读取失败不吞成零版本，不影响已核对的历史结果", async () => {
    io.targets.mockRejectedValueOnce(new Error("private-source-list"));
    const { container } = render(await page());
    expect(screen.getByRole("heading", { name: "版本来源清单暂时无法读取" })).toBeVisible();
    expect(screen.getByText("核对后的业务内容")).toBeVisible();
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("private-source-list"); expect(io.start).not.toHaveBeenCalled();
  });

  it("结果读取失败只降级结果，明确历史来源仍由真实来源独立核对", async () => {
    io.run.mockRejectedValueOnce(new Error("private-run-record"));
    const { container } = render(await page());
    expect(screen.getByRole("heading", { name: "内部运行结果暂时无法读取" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "历史材料（必填）" })).toBeEnabled();
    expect(screen.getByRole("region", { name: "内部试运行" })).toBeVisible();
    expect(container.textContent).not.toContain("private-run-record"); expect(io.start).not.toHaveBeenCalled();
  });

  it.each(["candidate", "private-unknown-status"])("实际来源状态%s不因不是production就冒称retired，也不开放新试运行", async (status) => {
    io.source.mockResolvedValue({ ...source, status });
    const { container } = render(await page());
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "内部运行结果" })).toHaveTextContent("不把未知状态当作可运行的历史版本");
    expect(screen.queryByText(/核对来源是已保存的历史版本/)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("private-unknown-status"); expect(io.start).not.toHaveBeenCalled();
  });
});
