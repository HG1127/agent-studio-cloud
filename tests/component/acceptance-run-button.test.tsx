import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcceptanceRunButton } from "@/features/quality/AcceptanceRunButton";

const mocks = vi.hoisted(() => ({ start: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/actions/evaluations", () => ({ startEvaluationAction: mocks.start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const agentId = "00000000-0000-4000-8000-000000000001";
const versionId = "00000000-0000-4000-8000-000000000002";
const nextVersionId = "00000000-0000-4000-8000-000000000003";
const props = { agentId, agentName: "合同助手", versionId, caseCount: 3, candidate: true, running: false, previouslyEvaluated: false };

describe("验收中心直接运行全部样例", () => {
  afterEach(() => {
    mocks.start.mockReset();
    mocks.refresh.mockReset();
    window.sessionStorage.clear();
  });

  it("只有候选版本和启用样例齐备时才提供直接验收", () => {
    const view = render(<AcceptanceRunButton {...props} caseCount={0} />);
    expect(screen.queryByRole("button", { name: "验收全部样例" })).not.toBeInTheDocument();
    view.rerender(<AcceptanceRunButton {...props} candidate={false} />);
    expect(screen.queryByRole("button", { name: "验收全部样例" })).not.toBeInTheDocument();
    view.rerender(<AcceptanceRunButton {...props} running />);
    expect(screen.queryByRole("button", { name: "验收全部样例" })).not.toBeInTheDocument();
  });

  it("确认前不写入；取消安全，确认后用请求标识运行现有动作", async () => {
    mocks.start.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<AcceptanceRunButton {...props} />);
    await user.click(await screen.findByRole("button", { name: "验收全部样例" }));
    const dialog = screen.getByRole("dialog", { name: "运行全部验收样例？" });
    expect(dialog).toHaveTextContent("合同助手");
    expect(dialog).toHaveTextContent("3 条已启用样例");
    expect(dialog).toHaveTextContent("可能自动上线");
    expect(mocks.start).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    expect(mocks.start).not.toHaveBeenCalled();
    await user.click(await screen.findByRole("button", { name: "验收全部样例" }));
    await user.click(within(screen.getByRole("dialog", { name: "运行全部验收样例？" })).getByRole("button", { name: "确认验收" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith(agentId, expect.any(String)));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("验收请求已处理");
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).toBeNull();
  });

  it("响应中断后跨刷新沿用同一请求核对", async () => {
    mocks.start.mockRejectedValueOnce(new Error("network interrupted")).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    const view = render(<AcceptanceRunButton {...props} />);
    await user.click(await screen.findByRole("button", { name: "验收全部样例" }));
    await user.click(within(screen.getByRole("dialog", { name: "运行全部验收样例？" })).getByRole("button", { name: "确认验收" }));
    expect(await screen.findByText("上次验收结果待核对")).toBeInTheDocument();
    const requestId = mocks.start.mock.calls[0][1];
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).toContain(requestId);
    view.unmount();

    render(<AcceptanceRunButton {...props} />);
    const retry = await screen.findByRole("button", { name: "核对上次验收" });
    await user.click(retry);
    const dialog = screen.getByRole("dialog", { name: "核对上次验收请求？" });
    expect(dialog).toHaveTextContent("不会新建另一轮");
    await user.click(within(dialog).getByRole("button", { name: "用原请求核对" }));
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(2));
    expect(mocks.start.mock.calls[1]).toEqual([agentId, requestId]);
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).toBeNull();
  });

  it("服务端返回无法确认的通用错误时保留请求，明确门禁拒绝则释放请求", async () => {
    mocks.start.mockResolvedValueOnce({ ok: false, error: "启动自动验收失败，请稍后重试" }).mockResolvedValueOnce({ ok: false, error: "请先添加至少一条验收样例" });
    const user = userEvent.setup();
    render(<AcceptanceRunButton {...props} />);
    await user.click(await screen.findByRole("button", { name: "验收全部样例" }));
    await user.click(within(screen.getByRole("dialog", { name: "运行全部验收样例？" })).getByRole("button", { name: "确认验收" }));
    expect(await screen.findByText("上次验收结果待核对")).toBeInTheDocument();
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "核对上次验收" }));
    await user.click(within(screen.getByRole("dialog", { name: "核对上次验收请求？" })).getByRole("button", { name: "用原请求核对" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先添加至少一条验收样例");
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).toBeNull();
  });

  it("核对期间版本变化时阻止旧请求启动新版本，须明确解除", async () => {
    window.sessionStorage.setItem(`agent-studio:acceptance-run:${agentId}`, JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000004", versionId }));
    const user = userEvent.setup();
    render(<AcceptanceRunButton {...props} versionId={nextVersionId} />);
    expect(await screen.findByText("上次验收结果待核对，版本已变化")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "核对上次验收" })).not.toBeInTheDocument();
    expect(mocks.start).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "已核对，继续操作" }));
    const dialog = screen.getByRole("dialog", { name: "已经核对上次验收？" });
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "已核对，继续操作" }));
    await user.click(within(screen.getByRole("dialog", { name: "已经核对上次验收？" })).getByRole("button", { name: "继续操作" }));
    expect(window.sessionStorage.getItem(`agent-studio:acceptance-run:${agentId}`)).toBeNull();
    expect(screen.getByRole("button", { name: "验收全部样例" })).toBeEnabled();
  });
});
