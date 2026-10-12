import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HarnessPage from "@/app/(console)/harness/page";
import { WebToolSources } from "@/features/web-tools/WebToolSources";
import { WebToolTrialResult } from "@/features/web-tools/WebToolTrialResult";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), start: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock("@/server/actions/start-run", () => ({ startRunAction: mocks.start }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: mocks.start }));
vi.mock("@/server/queries/agents", () => { throw new Error("private-agents-module DATABASE_URL_POOLED"); });
vi.mock("@/server/queries/versions", () => { throw new Error("private-versions-module DATABASE_URL_POOLED"); });
vi.mock("@/server/queries/runs", () => { throw new Error("private-runs-module DATABASE_URL_POOLED"); });
vi.mock("@/server/queries/trace", () => { throw new Error("private-trace-module DATABASE_URL_POOLED"); });
vi.mock("@/server/queries/execution-resources", () => { throw new Error("private-resources-module DATABASE_URL_POOLED"); });

const runId = "00000000-0000-4000-8000-000000000851";
const versionId = "00000000-0000-4000-8000-000000000852";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe("控制台读取模块初始化失败", () => {
  it("正式版本查询模块无法加载时保留读取失败，不显示空版本或试运行", async () => {
    const { container } = render(await WebToolSources({ navigation: { versionId, runId }, invalid: false }));
    expect(screen.getByRole("heading", { name: "版本来源清单暂时无法读取" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("没有把读取失败当成没有正式版本");
    expect(screen.queryByRole("combobox", { name: "用于核对的助手版本" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/private-|DATABASE_URL_POOLED|当前没有可核对的正式版本/);
    fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("关联结果查询模块无法加载时保留原关联与未知状态，不展示未经核对的结果", async () => {
    const { container } = render(await WebToolTrialResult({ navigation: { versionId, runId } }));
    expect(screen.getByRole("heading", { name: "内部运行结果暂时无法读取" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("保留原关联，可重新读取");
    expect(screen.queryByRole("heading", { name: "无法核对本次运行关联" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制已保存内容" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/private-|DATABASE_URL_POOLED|当前没有关联任务/);
    fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("没有关联任务时不必加载数据库查询模块，仍说明占位不是结果", async () => {
    render(await WebToolTrialResult({ navigation: {} }));
    expect(screen.getByRole("heading", { name: "内部运行结果" })).toBeVisible();
    expect(screen.getByText(/当前没有关联任务.*不是执行结果/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "内部运行结果暂时无法读取" })).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("运行和资源模块无法加载时各自报读取失败，不能填默认容量或误报任务失效", async () => {
    const { container } = render(await HarnessPage({ searchParams: Promise.resolve({ run: runId }) }));
    expect(screen.getByRole("heading", { name: "运行控制台" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "诊断详情暂时无法读取" })).toBeVisible();
    expect(screen.getByText(/最近运行列表读取失败/)).toBeVisible();
    expect(screen.getByText(/资源摘要暂时无法读取，当前上限与可用名额未知/)).toBeVisible();
    expect(screen.getByText(/资源设置历史暂时无法读取，不能按空记录显示/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "找不到这次运行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "本次证据读取" })).not.toBeInTheDocument();
    const form = within(screen.getByRole("form", { name: "修改资源限额" }));
    for (const input of form.getAllByRole("spinbutton")) {
      expect(input).toBeDisabled();
      expect(input).toHaveValue(null);
    }
    expect(form.getByRole("button", { name: "确认并保存资源设置" })).toBeDisabled();
    expect(container.textContent).not.toMatch(/private-|DATABASE_URL_POOLED|还没有运行记录|服务端默认设置|本页没有已读取的变更记录/);
    fireEvent.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("最近运行模块无法加载且未指定任务时不假定为空或自动选择任务", async () => {
    const { container } = render(await HarnessPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/最近运行列表读取失败/)).toBeVisible();
    expect(screen.getByText(/当前没有自动选择任务/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "诊断详情暂时无法读取" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/private-|DATABASE_URL_POOLED|还没有运行记录|最近 0 条/);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
