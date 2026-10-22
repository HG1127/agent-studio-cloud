import { useState, type ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebToolResultView } from "@/features/web-tools/WebToolResultView";
import { savedRunResultView } from "@/features/runs/run-result-view";

const result = savedRunResultView({
  result: { total: 0, approved: false, route: { next: "original-private-route", customer: "buyer@example.test" } },
  outputContract: { fields: [
    { path: "total", label: "预算", required: true },
    { path: "approved", label: "已确认", required: true },
    { path: "route", label: "分支结果", required: true },
  ] },
});

function StatefulPreview() {
  const [expanded, setExpanded] = useState(false);
  return <button type="button" onClick={() => setExpanded((current) => !current)}>{expanded ? "服务端预览已展开" : "展开服务端预览"}</button>;
}

afterEach(() => vi.restoreAllMocks());

describe("网页工具结果展示槽位", () => {
  it("按交付顺序使用槽位，切换两种布局不重建槽位状态", async () => {
    const user = userEvent.setup();
    const valuePreviews: readonly ReactNode[] = Object.freeze([
      <StatefulPreview key="total" />,
      <p key="approved">由服务端核对的确认预览</p>,
      <p key="route">由服务端核对的条件预览</p>,
    ]);
    render(<WebToolResultView result={result} valuePreviews={valuePreviews} />);
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    const items = within(outputs).getAllByRole("listitem");
    expect(within(items[0]).getByRole("button", { name: "展开服务端预览" })).toBeVisible();
    expect(within(items[1]).getByText("由服务端核对的确认预览")).toBeVisible();
    expect(within(items[2]).getByText("由服务端核对的条件预览")).toBeVisible();
    expect(within(outputs).queryByText("original-private-route")).not.toBeInTheDocument();
    await user.click(within(items[0]).getByRole("button", { name: "展开服务端预览" }));
    for (const label of ["交付清单", "字段卡片"]) {
      await user.click(within(screen.getByRole("group", { name: "已保存结果布局" })).getByRole("button", { name: label }));
      expect(within(items[0]).getByRole("button", { name: "服务端预览已展开" })).toBeVisible();
      expect(within(items[1]).getByText("由服务端核对的确认预览")).toBeVisible();
      expect(within(items[2]).getByText("由服务端核对的条件预览")).toBeVisible();
    }
    expect(Object.isFrozen(valuePreviews)).toBe(true);
  });

  it("槽位只控制展示，逐项与整体复制保留脱敏后的零、否和原始 next", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const valuePreviews: readonly ReactNode[] = [<p key="total">金额展示槽</p>, <p key="approved">确认展示槽</p>, <p key="route">中文条件展示槽</p>];
    render(<WebToolResultView result={result} valuePreviews={valuePreviews} />);
    await user.click(screen.getByRole("button", { name: "复制预算" }));
    expect(write).toHaveBeenLastCalledWith("0");
    await user.click(screen.getByRole("button", { name: "复制已确认" }));
    expect(write).toHaveBeenLastCalledWith("false");
    await user.click(screen.getByRole("button", { name: "复制分支结果" }));
    const routeCopy = JSON.stringify(result.outputs[2].output, null, 2);
    expect(write).toHaveBeenLastCalledWith(routeCopy);
    expect(routeCopy).toContain('"next": "original-private-route"');
    expect(routeCopy).not.toContain("buyer@example.test");
    await user.click(screen.getByRole("button", { name: "复制已保存内容" }));
    expect(write).toHaveBeenLastCalledWith(result.copyText);
    expect(write.mock.calls.flat().join(" ")).not.toMatch(/展示槽|buyer@example\.test/);
    expect(result.outputs[2].output).toMatchObject({ next: "original-private-route" });
  });

  it("未提供槽位时保持原结构化展示与复制", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<WebToolResultView result={result} />);
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).getByText("0")).toBeVisible();
    expect(within(outputs).getByText("否")).toBeVisible();
    expect(within(outputs).getByText("original-private-route")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "复制已保存内容" }));
    expect(write).toHaveBeenLastCalledWith(result.copyText);
  });

  it("短数组只替换对应交付项，其余沿用原展示，多余槽位不显示", () => {
    const { rerender } = render(<WebToolResultView result={result} valuePreviews={[<p key="first">预算专用槽</p>]} />);
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).getByText("预算专用槽")).toBeVisible();
    expect(within(outputs).queryByText("0")).not.toBeInTheDocument();
    expect(within(outputs).getByText("否")).toBeVisible();
    expect(within(outputs).getByText("original-private-route")).toBeVisible();
    rerender(<WebToolResultView result={result} valuePreviews={[<p key="first">预算专用槽</p>, <p key="second">确认专用槽</p>, <p key="third">条件专用槽</p>, <p key="extra">越界槽位</p>]} />);
    expect(within(outputs).queryByText("越界槽位")).not.toBeInTheDocument();
  });

  it("存在的空或假值槽位原样渲染，不误用原值回填", () => {
    const valuePreviews: readonly ReactNode[] = [null, false, 0];
    render(<WebToolResultView result={result} valuePreviews={valuePreviews} />);
    const items = within(screen.getByRole("list", { name: "已保存的交付内容" })).getAllByRole("listitem");
    expect(within(items[0]).queryByText("0")).not.toBeInTheDocument();
    expect(within(items[1]).queryByText("否")).not.toBeInTheDocument();
    expect(within(items[2]).getByText("0")).toBeVisible();
    expect(within(items[2]).queryByText("original-private-route")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制预算" })).toBeVisible();
  });
});
