import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionPanel } from "@/features/agents/VersionPanel";
import type { ModelConnectionView } from "@/contracts/connections";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

const { actionMock, restoreMock, refreshMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  restoreMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/server/actions/publish-version", () => ({ publishVersionAction: actionMock }));
vi.mock("@/server/actions/restore-version", () => ({ restoreVersionAction: restoreMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const AGENT_ID = "00000000-0000-4000-8000-000000000009";
const VERSIONS = [
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    version: 2,
    status: "production",
    createdAt: "2026-09-21T08:30:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    version: 1,
    status: "retired",
    createdAt: "2026-09-20T08:30:00.000Z",
  },
];

function renderPanel(versions = VERSIONS, connections: ModelConnectionView[] = []) {
  return render(<VersionPanel agentId={AGENT_ID} versions={versions} connections={connections} defaultModelLabel="演示模式" />);
}

describe("VersionPanel", () => {
  it("每条真实版本提供冻结流程入口并保留三个历史区分页，不调用写操作", () => {
    render(<VersionPanel agentId={AGENT_ID} versions={VERSIONS} connections={[]} defaultModelLabel="演示模式"
      versionPage={3} archivedCasesPage={2} evaluationRunsPage={4} />);
    const links = screen.getAllByRole("link", { name: "查看冻结流程" });
    expect(links).toHaveLength(2);
    for (const [index, link] of links.entries()) expect(link).toHaveAttribute("href",
      `/agents/${AGENT_ID}/versions/${VERSIONS[index].id}?versionsPage=3&archivedCasesPage=2&evaluationRunsPage=4`);
    expect(actionMock).not.toHaveBeenCalled();
    expect(restoreMock).not.toHaveBeenCalled();
  });
  afterEach(() => {
    actionMock.mockReset();
    restoreMock.mockReset();
    refreshMock.mockReset();
    window.sessionStorage.clear();
  });

  it("展示版本列表：版本号、「当前版本/历史版本」状态与时间", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "版本历史" })).toBeInTheDocument();
    expect(screen.getByText("版本 2")).toBeInTheDocument();
    expect(screen.getByText("版本 1")).toBeInTheDocument();
    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.getByText("历史版本")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "下载此版本" })[0]).toHaveAttribute(
      "href",
      `/api/agents/${AGENT_ID}/versions/${VERSIONS[0].id}/export`,
    );
    expect(screen.getByRole("link", { name: "与当前版本对比" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}/versions/compare?from=${VERSIONS[1].id}&to=${VERSIONS[0].id}`,
    );
    expect(screen.getAllByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toHaveLength(2);
  });

  it("没有版本时显示引导文案", () => {
    renderPanel([]);
    expect(screen.getByText(/还没有发布过版本/)).toBeInTheDocument();
    expect(screen.queryByText("当前版本")).not.toBeInTheDocument();
  });

  it.each([null, VERSIONS[0].id])("空的历史页只说明本页无记录，保留其他分区的页码（当前版本 %s）", (currentVersionId) => {
    render(<VersionPanel agentId={AGENT_ID} versions={[]} connections={[]} defaultModelLabel="演示模式"
      currentVersionId={currentVersionId} versionPage={2} archivedCasesPage={4} evaluationRunsPage={3} />);
    expect(screen.getByText("当前页没有版本记录")).toBeInTheDocument();
    expect(screen.queryByText("还没有发布过版本")).not.toBeInTheDocument();
    expect(screen.getByText("本页记录 0 个版本")).toBeInTheDocument();
    expect(screen.getByText("本页可恢复 0 个")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到版本第一页" })).toHaveAttribute("href", "?versionsPage=1&archivedCasesPage=4&evaluationRunsPage=3#versions");
    expect(actionMock).not.toHaveBeenCalled();
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("版本历史支持翻页，当前正式版本不在本页时不误称未发布", async () => {
    const user = userEvent.setup();
    render(<VersionPanel
      agentId={AGENT_ID}
      versions={[VERSIONS[1]]}
      connections={[]}
      defaultModelLabel="演示模式"
      currentVersionId={VERSIONS[0].id}
      versionPage={2}
      hasMoreVersions
    />);
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute("href", "?versionsPage=1#versions");
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute("href", "?versionsPage=3#versions");
    expect(screen.getByRole("link", { name: "与当前版本对比" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}/versions/compare?from=${VERSIONS[1].id}&to=${VERSIONS[0].id}`,
    );
    expect(screen.getByText("正式版本未列在本页")).toBeInTheDocument();
    expect(screen.queryByText("还没有可运行版本")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复为当前版本" }));
    expect(screen.getByRole("dialog", { name: "恢复历史版本 1？" })).toHaveTextContent("当前正式版本未列在本页");
  });

  it("版本翻页时保留已归档验收样例页码", () => {
    render(<VersionPanel
      agentId={AGENT_ID}
      versions={[VERSIONS[1]]}
      connections={[]}
      defaultModelLabel="演示模式"
      versionPage={2}
      hasMoreVersions
      archivedCasesPage={4}
    />);
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute(
      "href",
      "?versionsPage=1&archivedCasesPage=4#versions",
    );
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute(
      "href",
      "?versionsPage=3&archivedCasesPage=4#versions",
    );
  });

  it("版本翻页时保留验收记录页码", () => {
    render(<VersionPanel
      agentId={AGENT_ID}
      versions={[VERSIONS[1]]}
      connections={[]}
      defaultModelLabel="演示模式"
      versionPage={2}
      hasMoreVersions
      evaluationRunsPage={3}
    />);
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute(
      "href",
      "?versionsPage=1&evaluationRunsPage=3#versions",
    );
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute(
      "href",
      "?versionsPage=3&evaluationRunsPage=3#versions",
    );
  });

  it("流程有未保存修改时阻止发布旧草稿", async () => {
    renderPanel();
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: AGENT_ID, dirty: true } })));
    expect(screen.getByRole("button", { name: "请先保存草稿" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("保存后才能发布");
    expect(screen.getByRole("button", { name: "恢复为当前版本" })).toBeDisabled();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("历史版本可恢复为新的当前版本", async () => {
    restoreMock.mockResolvedValue({
      ok: true,
      version: {
        id: "00000000-0000-4000-8000-0000000000a3",
        version: 3,
        status: "production",
        createdAt: "2026-09-22T08:30:00.000Z",
      },
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "恢复为当前版本" }));
    const confirmation = screen.getByRole("dialog", { name: "恢复历史版本 1？" });
    expect(confirmation).toHaveTextContent("当前正式版本 2");
    expect(confirmation).toHaveTextContent("已有运行保留原版本");
    expect(confirmation).toHaveTextContent("待验收的候选版本会停止自动上线");
    expect(restoreMock).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "确认恢复" }));
    await waitFor(() => expect(restoreMock).toHaveBeenCalledWith(AGENT_ID, VERSIONS[1].id));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("生成新的正式版本 3");
    expect(screen.getByText("版本 3")).toBeInTheDocument();
    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.getAllByText("历史版本")).toHaveLength(2);
  });

  it("取消历史版本恢复不会调用写动作", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "恢复为当前版本" }));
    const confirmation = screen.getByRole("dialog", { name: "恢复历史版本 1？" });
    await user.click(within(confirmation).getByRole("button", { name: "返回" }));
    expect(screen.queryByRole("dialog", { name: "恢复历史版本 1？" })).not.toBeInTheDocument();
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it("历史版本恢复进行中不允许同时发布新版本", async () => {
    let finishRestore: (result: { ok: false; error: string }) => void = () => {};
    restoreMock.mockImplementation(() => new Promise<{ ok: false; error: string }>((resolve) => {
      finishRestore = resolve;
    }));
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "恢复为当前版本" }));
    await user.click(within(screen.getByRole("dialog", { name: "恢复历史版本 1？" })).getByRole("button", { name: "确认恢复" }));
    expect(screen.getByRole("button", { name: "正在恢复版本…" })).toBeDisabled();
    expect(actionMock).not.toHaveBeenCalled();
    finishRestore({ ok: false, error: "服务端未完成恢复" });
    expect(await screen.findByRole("alert")).toHaveTextContent("服务端未完成恢复");
    expect(screen.getByRole("button", { name: "发布新版本" })).toBeEnabled();
  });

  it("待验收与未上线版本不能绕过门禁恢复", () => {
    renderPanel([
      { ...VERSIONS[0], status: "candidate" },
      { ...VERSIONS[1], status: "superseded" },
    ]);
    expect(screen.getByText("待验收")).toBeInTheDocument();
    expect(screen.getByText("未上线")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复为当前版本" })).not.toBeInTheDocument();
  });

  it("候选版本明确引导到自动验收门槛", () => {
    renderPanel([{ ...VERSIONS[0], status: "candidate" }]);
    expect(screen.getByText("候选版本 2 等待自动验收")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往自动验收" })).toHaveAttribute("href", "#evaluation");
  });

  it("历史版本恢复失败时保留错误提示", async () => {
    restoreMock.mockResolvedValue({ ok: false, error: "历史版本格式过旧，无法直接恢复" });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "恢复为当前版本" }));
    await user.click(within(screen.getByRole("dialog", { name: "恢复历史版本 1？" })).getByRole("button", { name: "确认恢复" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("历史版本格式过旧");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("恢复响应丢失时保留核对线索并锁住再次上线，刷新后仍可核对", async () => {
    restoreMock.mockRejectedValue(new Error("network interrupted"));
    const user = userEvent.setup();
    const view = renderPanel();
    await user.click(screen.getByRole("button", { name: "恢复为当前版本" }));
    await user.click(within(screen.getByRole("dialog", { name: "恢复历史版本 1？" })).getByRole("button", { name: "确认恢复" }));
    expect(await screen.findByText("版本 1 的恢复结果尚未确认")).toBeInTheDocument();
    expect(screen.queryByText("恢复失败，请稍后重试")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复为当前版本" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "请先核对恢复状态" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "查看版本操作记录" })).toHaveAttribute("href", "/activity?type=version");
    expect(window.sessionStorage.getItem(`agent-studio:version-restore:${AGENT_ID}`)).toContain(VERSIONS[1].id);
    view.unmount();

    renderPanel();
    expect(await screen.findByText("版本 1 的恢复结果尚未确认")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "已核对，继续操作" }));
    const unlock = screen.getByRole("dialog", { name: "已核对上次版本恢复？" });
    await user.click(within(unlock).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("button", { name: "恢复为当前版本" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "已核对，继续操作" }));
    await user.click(within(screen.getByRole("dialog", { name: "已核对上次版本恢复？" })).getByRole("button", { name: "继续操作" }));
    expect(window.sessionStorage.getItem(`agent-studio:version-restore:${AGENT_ID}`)).toBeNull();
    expect(screen.getByRole("button", { name: "恢复为当前版本" })).toBeEnabled();
    expect(restoreMock).toHaveBeenCalledOnce();
  });

  it("点「发布新版本」调用发布动作，成功后刷新页面", async () => {
    const published = {
      id: "00000000-0000-4000-8000-0000000000a3",
      version: 3,
      status: "production",
      createdAt: "2026-09-22T08:30:00.000Z",
    };
    actionMock.mockResolvedValue({ ok: true, release: "production", exempted: [], version: published });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith(AGENT_ID, undefined);
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("版本 3")).toBeInTheDocument();
    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.getAllByText("历史版本")).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("选定连接和模型后发布，模型名中的冒号也完整保留", async () => {
    actionMock.mockResolvedValue({ ok: true, exempted: [] });
    const user = userEvent.setup();
    const connection: ModelConnectionView = {
      id: "00000000-0000-4000-8000-0000000000c1", name: "主力模型", baseUrl: "https://api.example.com/v1",
      apiKeyHint: "****1234", modelIds: ["test-model:latest"], isDefaultCompile: false, createdAt: "2026-09-23T00:00:00.000Z",
    };
    renderPanel(VERSIONS, [connection]);
    await user.selectOptions(screen.getByRole("combobox", { name: "运行模型" }), screen.getByRole("option", { name: "主力模型 / test-model:latest" }));
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith(AGENT_ID, { connectionId: connection.id, modelId: "test-model:latest" }));
  });

  it("服务端默认是真实模型时，不标成演示模式", () => {
    render(<VersionPanel agentId={AGENT_ID} versions={[]} connections={[]} defaultModelLabel="服务端默认模型" />);
    expect(screen.getByRole("option", { name: "服务端默认模型" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "演示模式" })).not.toBeInTheDocument();
  });

  it("发布被门禁拒绝时展示失败原因与阻塞问题列表，不刷新", async () => {
    actionMock.mockResolvedValue({
      ok: false,
      error: "设计检查未通过：还有 2 个阻塞问题，解决后才能发布",
      issues: ["没有定义最终交付物：流程只说明了怎么执行，却没有说明最终要交给员工什么结果。", "流程出现死路：「整理结果」执行后没有下一步。"],
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("设计检查未通过：还有 2 个阻塞问题");
    expect(screen.getByText(/没有定义最终交付物/)).toBeInTheDocument();
    expect(screen.getByText(/流程出现死路/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("发布请求中断后显示可读错误，保留模型选择并允许重试", async () => {
    actionMock.mockRejectedValueOnce(new Error("network failure"));
    actionMock.mockResolvedValueOnce({ ok: true, exempted: [] });
    const user = userEvent.setup();
    const connection: ModelConnectionView = {
      id: "00000000-0000-4000-8000-0000000000c1", name: "主力模型", baseUrl: "https://api.example.com/v1",
      apiKeyHint: "****1234", modelIds: ["test-model:latest"], isDefaultCompile: false, createdAt: "2026-09-23T00:00:00.000Z",
    };
    renderPanel(VERSIONS, [connection]);
    const selected = JSON.stringify([connection.id, "test-model:latest"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "运行模型" }), selected);
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("发布失败，请稍后重试");
    expect(screen.getByRole("button", { name: "发布新版本" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "运行模型" })).toHaveValue(selected);
    expect(refreshMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("发布中按钮不可重复点击", async () => {
    let resolveAction: (value: { ok: boolean }) => void = () => {};
    actionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    expect(screen.getByRole("button", { name: "正在发布…" })).toBeDisabled();
    resolveAction({ ok: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "发布新版本" })).toBeEnabled();
    });
  });

  it("发布成功但存在控制面豁免项时展示提醒与问题标题", async () => {
    actionMock.mockResolvedValue({
      ok: true,
      exempted: [{ title: "没有定义最终交付物" }, { title: "目标声明被误识别为工作流节点" }],
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    expect(await screen.findByText("已发布。还有 2 个控制面检查提醒")).toBeInTheDocument();
    expect(screen.getByText("没有定义最终交付物")).toBeInTheDocument();
    expect(screen.getByText("目标声明被误识别为工作流节点")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("发布成功且没有豁免项时不显示提醒", async () => {
    actionMock.mockResolvedValue({ ok: true, exempted: [] });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/控制面检查提醒/)).not.toBeInTheDocument();
  });

  it("有验收样例时提示先验收再自动上线", async () => {
    actionMock.mockResolvedValue({ ok: true, release: "candidate", exempted: [] });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    expect(await screen.findByRole("status")).toHaveTextContent("待验收版本已创建");
  });
});
