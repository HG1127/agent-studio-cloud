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
  it("复制外部系统接入地址和一次性提交凭据", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" submissionToken="submit-token" />);

    fireEvent.click(screen.getByText("让外部系统继续这次运行"));
    fireEvent.click(screen.getByRole("button", { name: "复制接入地址" }));
    expect(await screen.findByRole("status")).toHaveTextContent("接入地址已复制");
    expect(writeText).toHaveBeenLastCalledWith("http://localhost:3000/api/runs/00000000-0000-4000-8000-000000000001/events/customer.updated");

    fireEvent.click(screen.getByRole("button", { name: "复制提交凭据" }));
    expect(await screen.findByRole("status")).toHaveTextContent("提交凭据已复制");
    expect(writeText).toHaveBeenLastCalledWith("submit-token");
  });

  it("旧运行没有安全提交凭据时不展示外部接入入口", () => {
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" submissionToken={null} />);
    expect(screen.queryByText("让外部系统继续这次运行")).not.toBeInTheDocument();
  });

  it("提交对象消息后继续运行", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" submissionToken="submit-token" />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: '{"complete":true}' } });
    await user.click(screen.getByRole("button", { name: "提交并继续" }));
    expect(await screen.findByRole("status")).toHaveTextContent("消息已提交，运行将继续");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/00000000-0000-4000-8000-000000000001/events/customer.updated",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json", "x-wait-event-token": "submit-token" },
        body: '{"complete":true}',
      }),
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("进入下一次等待时清空上一轮内容和成功提示", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(<WaitEventPanel
      runId="00000000-0000-4000-8000-000000000001"
      eventKey="customer.updated"
      title="等待客户补充资料"
      submissionToken="first-token"
      payloadSchema={{ type: "object", required: ["complete"], properties: { complete: { type: "boolean" } } }}
    />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: '{"complete":true}' } });
    await user.click(screen.getByRole("button", { name: "提交并继续" }));
    expect(await screen.findByRole("status")).toHaveTextContent("消息已提交，运行将继续");

    rerender(<WaitEventPanel
      runId="00000000-0000-4000-8000-000000000001"
      eventKey="order.ready"
      title="等待订单就绪"
      submissionToken="second-token"
      payloadSchema={{ type: "object", required: ["orderId"], properties: { orderId: { type: "string" } } }}
    />);

    expect(screen.getByLabelText("消息内容")).toHaveValue(JSON.stringify({ orderId: "" }, null, 2));
    expect(screen.queryByText("消息已提交，运行将继续")).not.toBeInTheDocument();
  });

  it("拒绝文字和列表格式且不发送请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" submissionToken="submit-token" />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: "[]" } });
    await user.click(screen.getByRole("button", { name: "提交并继续" }));
    expect(screen.getByRole("alert")).toHaveTextContent("消息内容需要是一个对象");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("拒绝包含保留字段的消息并展示具体原因", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitEventPanel runId="00000000-0000-4000-8000-000000000001" eventKey="customer.updated" title="等待客户补充资料" submissionToken="submit-token" />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText("消息内容"), { target: { value: '{"nested":{"constructor":"blocked"}}' } });
    await user.click(screen.getByRole("button", { name: "提交并继续" }));
    expect(screen.getByRole("alert")).toHaveTextContent("等待消息不能使用保留字段名");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("展示等待消息的必填字段", () => {
    render(<WaitEventPanel
      runId="00000000-0000-4000-8000-000000000001"
      eventKey="customer.updated"
      title="等待客户补充资料"
      submissionToken="submit-token"
      payloadSchema={{ type: "object", required: ["complete", "note"] }}
    />);
    expect(screen.getByText("必填字段：complete、note")).toBeInTheDocument();
  });

  it("按字段契约生成包含嵌套字段与枚举值的消息模板", () => {
    render(<WaitEventPanel
      runId="00000000-0000-4000-8000-000000000001"
      eventKey="customer.updated"
      title="等待客户补充资料"
      submissionToken="submit-token"
      payloadSchema={{
        type: "object",
        required: ["complete", "customer", "state"],
        properties: {
          complete: { type: "boolean" },
          customer: {
            type: "object",
            required: ["id", "score"],
            properties: { id: { type: "string" }, score: { type: "number" } },
          },
          state: { enum: ["ready", "cancelled"] },
        },
      }}
    />);

    expect(screen.getByLabelText("消息内容")).toHaveValue(JSON.stringify({
      complete: false,
      customer: { id: "", score: 0 },
      state: "ready",
    }, null, 2));
  });
});
