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

  it("展示等待消息的必填字段", () => {
    render(<WaitEventPanel
      runId="00000000-0000-4000-8000-000000000001"
      eventKey="customer.updated"
      title="等待客户补充资料"
      payloadSchema={{ type: "object", required: ["complete", "note"] }}
    />);
    expect(screen.getByText("必填字段：complete、note")).toBeInTheDocument();
  });

  it("按字段契约生成包含嵌套字段与枚举值的消息模板", () => {
    render(<WaitEventPanel
      runId="00000000-0000-4000-8000-000000000001"
      eventKey="customer.updated"
      title="等待客户补充资料"
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
