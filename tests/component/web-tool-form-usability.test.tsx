import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentInputContract } from "@/contracts/manifest";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";
import { WebToolResultView } from "@/features/web-tools/WebToolResultView";
import { savedRunResultView } from "@/features/runs/run-result-view";

vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: vi.fn() }));

const fields = AgentInputContract.parse({ fields: [
  { name: "summary", label: "业务需求", type: "string", required: true },
  { name: "budget", label: "预算", type: "number", required: true },
  { name: "approved", label: "负责人确认", type: "boolean", required: true },
] }).fields;

describe("网页工具长表单与逐项交付", () => {
  it("定位未填写必填，零和否计为填写，但不冒充格式通过", async () => {
    const user = userEvent.setup();
    render(<WebToolInputPreview fields={fields} />);
    await user.click(screen.getByRole("button", { name: "定位下一项未填必填" }));
    expect(screen.getByRole("textbox", { name: /业务需求/ })).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: /业务需求/ }), "业务说明");
    await user.click(screen.getByRole("button", { name: "定位下一项未填必填" }));
    expect(screen.getByRole("textbox", { name: /预算/ })).toHaveFocus();
    await user.type(screen.getByRole("textbox", { name: /预算/ }), "0");
    await user.selectOptions(screen.getByRole("combobox", { name: /负责人确认/ }), "false");
    expect(screen.getByText(/已填写 3 \/ 3 项必填/)).toHaveTextContent("填写进度不代表格式或业务内容通过");
    expect(screen.queryByRole("button", { name: "定位下一项未填必填" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("扩大填写区不改变内容和校验结果，新版本重置展示配置", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WebToolInputPreview key="first" fields={fields.slice(0, 1)} />);
    const control = screen.getByRole("textbox", { name: /业务需求/ });
    await user.type(control, "长说明");
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    await user.click(screen.getByRole("button", { name: "展开第 1 项填写区" }));
    expect(control).toHaveAttribute("rows", "8");
    expect(control).toHaveValue("长说明");
    expect(screen.getByRole("status")).toHaveTextContent("已核对 1 项填写格式");
    expect(screen.getByText("已填写 3 个字符")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "收起第 1 项填写区" }));
    expect(control).toHaveAttribute("rows", "3");
    rerender(<WebToolInputPreview key="second" fields={fields.slice(0, 1)} />);
    expect(screen.getByRole("textbox", { name: /业务需求/ })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /业务需求/ })).toHaveAttribute("rows", "3");
  });

  it("逐项复制使用共享脱敏后的保存结果，零、否和完整结构均保留", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const result = savedRunResultView({ result: { total: 0, accepted: false, report: { email: "buyer@example.test", summary: "保存的业务依据" } }, outputContract: { fields: [
      { path: "total", label: "预算", required: true },
      { path: "accepted", label: "已确认", required: true },
      { path: "report", label: "报告", required: true },
    ] } });
    render(<WebToolResultView result={result} />);
    await user.click(screen.getByRole("button", { name: "复制预算" }));
    expect(write).toHaveBeenLastCalledWith("0");
    await user.click(screen.getByRole("button", { name: "复制已确认" }));
    expect(write).toHaveBeenLastCalledWith("false");
    await user.click(screen.getByRole("button", { name: "复制报告" }));
    expect(write).toHaveBeenLastCalledWith(JSON.stringify(result.outputs[2].output, null, 2));
    expect(write.mock.calls.flat().join(" ")).not.toContain("buyer@example.test");
    await user.click(within(screen.getByRole("group", { name: "已保存结果布局" })).getByRole("button", { name: "交付清单" }));
    expect(screen.getByRole("button", { name: "复制报告" })).toBeVisible();
    write.mockRestore();
  });

  it("复制失败反馈真实错误，不声称已复制", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const result = savedRunResultView({ result: "已保存内容", outputContract: { fields: [] } });
    render(<WebToolResultView result={result} />);
    await user.click(screen.getByRole("button", { name: "复制交付内容" }));
    expect(screen.getByRole("alert")).toHaveTextContent("复制失败");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    write.mockRestore();
  });
});
