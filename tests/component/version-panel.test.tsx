import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VersionPanel } from "@/features/agents/VersionPanel";
import type { ModelConnectionView } from "@/contracts/connections";

const { actionMock, refreshMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/server/actions/publish-version", () => ({ publishVersionAction: actionMock }));
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
  afterEach(() => {
    actionMock.mockReset();
    refreshMock.mockReset();
  });

  it("展示版本列表：版本号、「当前版本/历史版本」状态与时间", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "版本历史" })).toBeInTheDocument();
    expect(screen.getByText("版本 2")).toBeInTheDocument();
    expect(screen.getByText("版本 1")).toBeInTheDocument();
    expect(screen.getByText("当前版本")).toBeInTheDocument();
    expect(screen.getByText("历史版本")).toBeInTheDocument();
    expect(screen.getAllByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toHaveLength(2);
  });

  it("没有版本时显示引导文案", () => {
    renderPanel([]);
    expect(screen.getByText(/还没有发布过版本/)).toBeInTheDocument();
    expect(screen.queryByText("当前版本")).not.toBeInTheDocument();
  });

  it("点「发布新版本」调用发布动作，成功后刷新页面", async () => {
    actionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith(AGENT_ID, undefined);
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
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

  it("发布成功但存在豁免项时展示演示期提醒与问题标题", async () => {
    actionMock.mockResolvedValue({
      ok: true,
      exempted: [{ title: "没有定义最终交付物" }, { title: "目标声明被误识别为工作流节点" }],
    });
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "发布新版本" }));
    expect(await screen.findByText("已发布。演示期提醒：还有 2 个设计检查问题待处理")).toBeInTheDocument();
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
    expect(screen.queryByText(/演示期提醒/)).not.toBeInTheDocument();
  });
});
