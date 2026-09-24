import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WaitEventPanel } from "@/features/runs/WaitEventPanel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("等待消息面板", () => {
  it("提交对象消息后继续运行", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: '{"complete":true}' } });
    await user.click(screen.getByRole("button", { name: "提交并继续" }));
    expect(await screen.findByRole("status")).toHaveTextContent("消息已提交，运行将继续");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/00000000-0000-4000-8000-000000000001/events/customer.updated",
      expect.objectContaining({ method: "POST", body: '{"complete":true}' }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("拒绝文字和列表格式且不发送请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: "[]" } });
    await user.click(screen.getByRole("button", { name: "提交并继续" }));
    expect(screen.getByRole("alert")).toHaveTextContent("消息内容需要是一个对象");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
