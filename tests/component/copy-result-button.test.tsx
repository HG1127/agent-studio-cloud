import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyResultButton } from "@/features/runs/CopyResultButton";

const writeText = vi.fn();

afterEach(() => writeText.mockReset());

describe("复制最终结果", () => {
  it("把结构化结果复制为易读 JSON", async () => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyResultButton result={{ report: { conclusion: "通过" } }} />);
    await userEvent.click(screen.getByRole("button", { name: "复制最终结果" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify({ report: { conclusion: "通过" } }, null, 2));
    expect(await screen.findByRole("status")).toHaveTextContent("已复制");
  });

  it("浏览器拒绝剪贴板权限时给出手动复制提示", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyResultButton result="最终答复" />);
    await userEvent.click(screen.getByRole("button", { name: "复制最终结果" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("手动复制");
  });

  it("有业务展示文本时优先复制业务名称而非内部字段", async () => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyResultButton result={{ output_1: "已生成" }} text={"回复邮件\n已生成"} />);
    await userEvent.click(screen.getByRole("button", { name: "复制最终结果" }));
    expect(writeText).toHaveBeenCalledWith("回复邮件\n已生成");
  });
});
