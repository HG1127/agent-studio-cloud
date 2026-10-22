import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";
import { webToolSourceRun, webToolSourceSteps, webToolSourceVersionId } from "../fixtures/web-tool-result-source";

const mocks = vi.hoisted(() => ({ run: vi.fn(), source: vi.fn(), steps: vi.fn(), start: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("@/server/queries/runs", () => ({ getRunView: mocks.run, listRunSteps: mocks.steps }));
vi.mock("@/server/queries/versions", () => ({ getVersionExportSource: mocks.source }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
const sources: TestSource[] = [];
class TestSource {
  readonly close = vi.fn();
  readonly listeners = new Map<string, EventListener[]>();
  constructor(readonly url: string) { sources.push(this); }
  addEventListener(name: string, listener: EventListener) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  emit(name: string, data = "") { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data })); }
}
const run = RunView.parse({ ...webToolSourceRun, status: "running" });
const navigation = { versionId: webToolSourceVersionId, runId: run.id };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sources.length = 0; vi.stubGlobal("EventSource", TestSource);
  mocks.run.mockResolvedValue(run); mocks.source.mockResolvedValue({ version: 4, status: "production" }); mocks.steps.mockResolvedValue(webToolSourceSteps);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("网页真实结果父页的自动更新边界", () => {
  it("只在实际手动任务及版本归属验证后挂订阅，暂停不写业务", async () => {
    render(await WebToolTrialResult({ navigation }));
    expect(sources).toHaveLength(1); expect(sources[0].url).toContain("/api/runs/" + run.id + "/events");
    expect(screen.getByRole("region", { name: "本次任务自动更新" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "暂停本页自动更新" }));
    expect(sources[0].close).toHaveBeenCalledOnce(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["evaluation", "schedule", "agent_call", "handoff"] as const)("未经验证的 %s 运行不得订阅其状态", async (sourceType) => {
    mocks.run.mockResolvedValue({ ...run, sourceType });
    render(await WebToolTrialResult({ navigation }));
    expect(sources).toHaveLength(0); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.steps).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "本次任务自动更新" })).not.toBeInTheDocument();
  });
  it("版本不属于同一助手时不挂连接，也不显示结果", async () => {
    mocks.source.mockResolvedValue(null);
    render(await WebToolTrialResult({ navigation }));
    expect(sources).toHaveLength(0);
    expect(screen.getByRole("alert")).toHaveTextContent("未展示未经核对的输入或结果");
  });
  it("刷新用真实服务端结果替换，不把流结束直接当业务通过", async () => {
    const view = render(await WebToolTrialResult({ navigation }));
    expect(screen.getByRole("heading", { name: "已保存内容（尚未确认最终交付）" })).toBeVisible();
    act(() => sources[0].emit("done", '{"status":"completed"}'));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "已保存的交付结果" })).not.toBeInTheDocument();
    mocks.run.mockResolvedValue(webToolSourceRun);
    view.rerender(await WebToolTrialResult({ navigation }));
    expect(screen.getByRole("heading", { name: "已保存的交付结果" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "本次任务自动更新" })).not.toBeInTheDocument();
    expect(sources[0].close).toHaveBeenCalledOnce(); expect(mocks.start).not.toHaveBeenCalled();
  });
});
