import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunStepView } from "@/contracts/run";
import { RunStepRecord } from "@/features/runs/RunStepRecord";

const writeText = vi.fn();
let user: ReturnType<typeof userEvent.setup>;
const date = new Date("2026-10-08T01:02:03.000Z");

function savedStep(output: unknown, status: RunStepView["status"] = "succeeded") {
  return RunStepView.parse({
    id: "00000000-0000-4000-8000-000000000091", runId: "00000000-0000-4000-8000-000000000092",
    nodeId: "private-node-reference", nodeTitle: "核对客户需求", nodeType: "llm", status, attempt: 1,
    output, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  user = userEvent.setup();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

async function openRecord() {
  const record = screen.getByLabelText("核对客户需求的执行记录");
  if (!record.hasAttribute("open")) await user.click(within(record).getByText("查看执行记录与步骤产出"));
  return record;
}

describe("真实步骤记录与产出核对", () => {
  it.each([
    [0, "0"], [false, "否"], ["", "已保存空文字。"], [[], "已保存空列表。"], [{}, "已保存空对象。"],
    ["已核对客户需求", "已核对客户需求"],
  ])("保留已保存值 %j 的预览、原始数据与复制", async (output, label) => {
    const step = savedStep(output);
    render(<RunStepRecord step={step} />);
    expect(screen.getByLabelText("核对客户需求的执行记录")).not.toHaveAttribute("open");
    const record = await openRecord();
    expect(within(screen.getByRole("group", { name: "步骤产出预览" })).getByText(label as string)).toBeVisible();
    expect(record).toHaveTextContent("不是本次最终交付");
    await user.click(within(record).getByText("查看步骤数据（开发者数据）"));
    await user.click(within(record).getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(output, null, 2));
    expect(within(record).getByRole("status")).toHaveTextContent("已复制");
  });

  it.each(["pending", "running", "succeeded", "failed"] as const)("在 %s 产出记录为空时不补造内容或复制入口", async (status) => {
    render(<RunStepRecord step={savedStep(null, status)} />);
    const record = await openRecord();
    expect(record).toHaveTextContent(status === "succeeded" ? "已标记完成，但没有可核对的产出内容" : "当前记录没有可核对的步骤产出");
    expect(screen.queryByRole("group", { name: "步骤产出预览" })).not.toBeInTheDocument();
    expect(screen.queryByText("查看步骤数据（开发者数据）")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制脱敏步骤数据" })).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("失败步骤默认展开，产出不冒充成功，失败原因与数据均脱敏", async () => {
    render(<RunStepRecord step={{
      ...savedStep({ summary: "仍需核对", token: "private-step-secret", nested: { text: "请联系 person@example.com" } }, "failed"),
      attempt: 3, error: "Authorization: Bearer upstream-private-value 请核对连接",
    }} />);
    const record = screen.getByLabelText("核对客户需求的执行记录");
    expect(record).toHaveAttribute("open");
    expect(record).toHaveTextContent("已记录 3 次尝试");
    expect(record).toHaveTextContent("2026/10/08");
    expect(record).toHaveTextContent("09:02:03");
    expect(record).toHaveTextContent("已有产出不代表这个步骤已成功完成");
    expect(record).toHaveTextContent("请核对连接");
    expect(record.textContent).not.toMatch(/private-step-secret|upstream-private-value|person@example.com/);
    await user.click(within(record).getByText("查看步骤数据（开发者数据）"));
    await user.click(within(record).getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(writeText.mock.calls[0]?.[0]).toContain("已隐藏敏感信息");
    expect(writeText.mock.calls[0]?.[0]).not.toMatch(/private-step-secret|upstream-private-value|person@example.com/);
  });

  it.each([BigInt(1), () => "不可序列化"])("不可读内容不导致整条执行记录崩溃，也不创建空数据", async (output) => {
    render(<RunStepRecord step={savedStep(output)} />);
    const record = await openRecord();
    expect(within(record).getByRole("alert")).toHaveTextContent("步骤产出暂时无法显示");
    expect(record).toHaveTextContent("已记录 1 次尝试");
    expect(screen.queryByText("已保存空对象。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "复制脱敏步骤数据" })).not.toBeInTheDocument();
  });

  it("业务预览不显示内部关联字段，但开发者数据保留真实关联", async () => {
    const output = { summary: "客户需求已核对", childRunId: "private-child-reference", nested: { nodeId: "private-node-reference", text: "可继续处理" } };
    render(<RunStepRecord step={savedStep(output)} />);
    const record = await openRecord();
    const preview = screen.getByRole("group", { name: "步骤产出预览" });
    expect(preview).toHaveTextContent("客户需求已核对");
    expect(preview).toHaveTextContent("可继续处理");
    expect(preview.textContent).not.toMatch(/private-child-reference|private-node-reference|childRunId|nodeId/);
    expect(preview).toHaveTextContent("内部关联字段仅在原始数据中展示");
    const raw = within(record).getByText("查看步骤数据（开发者数据）").parentElement!;
    expect(raw).not.toHaveAttribute("open");
    await user.click(within(record).getByText("查看步骤数据（开发者数据）"));
    expect(raw.querySelector("pre")).toHaveTextContent("private-child-reference");
  });

  it("条件步骤只有路由关联字段时明确说明，不把内部路径当业务交付", async () => {
    render(<RunStepRecord step={{ ...savedStep({ matched: "private-case-reference", next: "private-next-reference" }), nodeType: "condition" }} />);
    await openRecord();
    const preview = screen.getByRole("group", { name: "步骤产出预览" });
    expect(preview).toHaveTextContent("此处只有内部关联字段");
    expect(preview.textContent).not.toMatch(/private-case-reference|private-next-reference/);
    expect(screen.getByText("查看步骤数据（开发者数据）")).toBeVisible();
  });

  it.each(["array", "object"])("长 %s 只缩小预览，原始数据与复制仍完整", async (kind) => {
    const rows = Array.from({ length: 12 }, (_, index) => "业务记录 " + (index + 1));
    const output = kind === "array" ? rows : Object.fromEntries(rows.map((value, index) => ["business_" + index, value]));
    render(<RunStepRecord step={savedStep(output)} />);
    const record = await openRecord();
    const preview = screen.getByRole("group", { name: "步骤产出预览" });
    expect(preview).toHaveTextContent("预览前 10 项，另有 2 项");
    expect(within(preview).getByText("业务记录 10")).toBeVisible();
    expect(within(preview).queryByText("业务记录 11")).not.toBeInTheDocument();
    await user.click(within(record).getByText("查看步骤数据（开发者数据）"));
    expect(record.querySelector("pre")).toHaveTextContent("业务记录 12");
    await user.click(within(record).getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(output, null, 2));
  });

  it("新产出重新读取后清除旧复制回执，复制的是当前记录", async () => {
    const { rerender } = render(<RunStepRecord step={savedStep({ summary: "旧产出" })} />);
    let record = await openRecord();
    await user.click(within(record).getByText("查看步骤数据（开发者数据）"));
    await user.click(within(record).getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(screen.getByRole("status")).toHaveTextContent("已复制");
    rerender(<RunStepRecord step={savedStep({ summary: "新产出" })} />);
    record = await openRecord();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(within(record).getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(writeText).toHaveBeenLastCalledWith(JSON.stringify({ summary: "新产出" }, null, 2));
  });

  it("缺失次数与无效时间保持未知，不推断耗时或尝试次数", async () => {
    render(<RunStepRecord step={{ ...savedStep(null), attempt: 0, startedAt: null, finishedAt: new Date("invalid") }} />);
    const record = await openRecord();
    expect(record).toHaveTextContent("暂无尝试次数记录");
    expect(record).toHaveTextContent("尚无记录");
    expect(record).toHaveTextContent("时间记录不可用");
    expect(record).not.toHaveTextContent("已记录 1 次尝试");
  });

  it("记录摘要可键盘聚焦，剪贴板失败只提示手动复制，不提交业务动作", async () => {
    writeText.mockRejectedValue(new Error("拒绝剪贴板"));
    render(<RunStepRecord step={savedStep("客户需求已核对")} />);
    await user.tab();
    expect(screen.getByText("查看执行记录与步骤产出")).toHaveFocus();
    await user.click(screen.getByText("查看执行记录与步骤产出"));
    const record = screen.getByLabelText("核对客户需求的执行记录");
    expect(record).toHaveAttribute("open");
    await user.click(within(record).getByText("查看步骤数据（开发者数据）"));
    await user.click(within(record).getByRole("button", { name: "复制脱敏步骤数据" }));
    expect(within(record).getByRole("alert")).toHaveTextContent("手动复制");
    expect(record).toHaveTextContent("客户需求已核对");
  });
});
