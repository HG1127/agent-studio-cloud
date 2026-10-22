import { isValidElement, type ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";
import { SavedRunResultValue } from "@/features/runs/SavedRunResultValue";
import { WebToolSavedRun } from "@/features/web-tools/WebToolSavedRun";
import { savedRunResultView } from "@/features/runs/run-result-view";
import { webToolSourceRun as run, webToolSourceSteps as steps, webToolSourceVersionId as selectedVersionId } from "../fixtures/web-tool-result-source";

const mocks = vi.hoisted(() => ({ clientProps: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/web-tools/WebToolResultView", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/web-tools/WebToolResultView")>();
  return { WebToolResultView: (props: ComponentProps<typeof original.WebToolResultView>) => { mocks.clientProps(props); return <original.WebToolResultView {...props} />; } };
});

function saved(actual = run, actualSteps = steps) {
  return <WebToolSavedRun run={actual} steps={actualSteps} selectedVersionId={selectedVersionId} selectedVersion={4} sourceStatus="production" />;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("网页交付的服务端结果槽位组合", () => {
  it("整步条件用真实同次步骤核对去向，两布局保留投射，复制仍保留原 next", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(saved());
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    const projection = within(outputs).getByRole("group", { name: "条件结果核对" });
    expect(projection).toHaveTextContent("需要继续处理");
    expect(projection).toHaveTextContent("整理业务结论");
    expect(projection).toHaveTextContent("核对后的业务内容");
    expect(projection.textContent).not.toMatch(/private-next-step|private-condition-step/);
    for (const label of ["交付清单", "字段卡片"]) {
      await user.click(within(screen.getByRole("group", { name: "已保存结果布局" })).getByRole("button", { name: label }));
      expect(within(outputs).getByRole("group", { name: "条件结果核对" })).toHaveTextContent("整理业务结论");
    }
    const expected = savedRunResultView(run);
    await user.click(screen.getByRole("button", { name: "复制判断依据" }));
    expect(write).toHaveBeenLastCalledWith(JSON.stringify(expected.outputs[0].output, null, 2));
    await user.click(screen.getByRole("button", { name: "复制已保存内容" }));
    expect(write).toHaveBeenLastCalledWith(expected.copyText);
    expect(expected.copyText).toContain('"next": "private-next-step"');
  });

  it("非空来源路径的嵌套业务值不投射为整步条件，零和否保留", () => {
    const business = { matched: "客户填写的状态", next: "下一次业务联系", total: 0, approved: false };
    const nested = RunView.parse({ ...run, result: { business }, outputContract: { fields: [{ path: "business", label: "业务安排", required: true, sourceNodeId: "private-condition-step", sourcePath: ["business"] }] } });
    render(saved(nested, [{ ...steps[0], output: { ...(steps[0].output as Record<string, unknown>), business } }, steps[1]]));
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
    expect(within(outputs).getByText("客户填写的状态")).toBeVisible();
    expect(within(outputs).getByText("下一次业务联系")).toBeVisible();
    expect(within(outputs).getByText("0")).toBeVisible();
    expect(within(outputs).getByText("否")).toBeVisible();
  });

  it("别次任务的去向名称不能核对，保留未知而不推测后续完成", () => {
    render(saved(run, [steps[0], { ...steps[1], runId: "00000000-0000-4000-8000-000000000816" }]));
    const projection = screen.getByRole("group", { name: "条件结果核对" });
    expect(projection).toHaveTextContent("后续步骤名称尚未读到");
    expect(projection).not.toHaveTextContent("整理业务结论");
    expect(projection).toHaveTextContent("不代表后续步骤已完成");
  });

  it("缺少来源或实际来源值不匹配时保留普通业务值，不猜测条件", () => {
    const business = { matched: "业务自有状态", next: "业务后续安排" };
    const actual = RunView.parse({ ...run, result: { decision: business } });
    render(saved(actual));
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
    expect(within(outputs).getByText("业务自有状态")).toBeVisible();
    expect(within(outputs).getByText("业务后续安排")).toBeVisible();
  });

  it("客户端直接 props 只有脱敏结果和 Server 节点槽，没有 raw 步骤或原运行证据", () => {
    const sensitiveRun = RunView.parse({ ...run, result: { decision: { matched: "需要继续处理", next: "private-next-step", note: "联系 buyer@example.test" } } });
    const actualSteps = [{ ...steps[0], output: { matched: "需要继续处理", next: "private-next-step", note: "联系 buyer@example.test" } }, steps[1]];
    const { container } = render(saved(sensitiveRun, actualSteps));
    const props = mocks.clientProps.mock.lastCall?.[0] as ComponentProps<typeof import("@/features/web-tools/WebToolResultView").WebToolResultView>;
    expect(Object.keys(props).sort()).toEqual(["result", "valuePreviews"]);
    expect(props).not.toHaveProperty("steps"); expect(props).not.toHaveProperty("run");
    expect(JSON.stringify(props.result)).not.toContain("buyer@example.test");
    expect(JSON.stringify(props.result)).not.toMatch(/private-step-only-body|private-step-credential|private-step-error/);
    const slot = props.valuePreviews?.[0];
    expect(isValidElement(slot)).toBe(true);
    if (!isValidElement<ComponentProps<typeof SavedRunResultValue>>(slot)) throw new Error("Server slot missing");
    expect(slot.type).toBe(SavedRunResultValue);
    expect(Object.keys(slot.props.run).sort()).toEqual(["id", "outputContract"]);
    expect(slot.props.fieldKey).toBe("decision");
    expect(JSON.stringify(slot.props.value)).not.toContain("buyer@example.test");
    expect(container.textContent).not.toMatch(/buyer@example.test|private-step-only-body|private-step-credential|private-step-error|private-destination-error/);
  });

  it("步骤读取失败即使误附有步骤也不使用证据，保留最终内容和未知提示", () => {
    render(<WebToolSavedRun run={run} steps={steps} stepsUnavailable selectedVersionId={selectedVersionId} selectedVersion={4} sourceStatus="production" />);
    expect(screen.queryByRole("group", { name: "条件结果核对" })).not.toBeInTheDocument();
    expect(screen.getByText(/交付来源的核对状态未知/)).toBeVisible();
    expect(screen.getByText("核对后的业务内容")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制已保存内容" })).toBeVisible();
  });

  it("顶层字符串使用已有正文展示器，不显示推理包装或格式片段，复制仍为原脱敏内容", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const raw = '<think>private-thinking-body</think>\n```json\n{"reply_suggestion":"已核对的业务答复","internal_marker":"private-format-fragment"}\n```';
    const textRun = RunView.parse({ ...run, result: { report: raw }, outputContract: { fields: [{ path: "report", label: "业务正文", required: true }] } });
    render(saved(textRun));
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).getByText("已核对的业务答复")).toBeVisible();
    expect(screen.getByText("展示的是整理后的正文；复制保留已保存的数据，请核对后使用。")).toBeVisible();
    expect(outputs.textContent).not.toMatch(/private-thinking-body|private-format-fragment|reply_suggestion|```|<think>/);
    await user.click(screen.getByRole("button", { name: "复制业务正文" }));
    expect(write).toHaveBeenLastCalledWith(raw);
    await user.click(screen.getByRole("button", { name: "复制已保存内容" }));
    expect(write).toHaveBeenLastCalledWith(savedRunResultView(textRun).copyText);
    expect(mocks.clientProps.mock.lastCall?.[0].result.outputs[0].output).toBe(raw);
  });

  it("未闭合推理包装保持正文未知提示，不泄出包装内容或声称已审阅", () => {
    const raw = "<think>private-unfinished-thinking";
    const textRun = RunView.parse({ ...run, result: { report: raw }, outputContract: { fields: [{ path: "report", label: "业务正文", required: true }] } });
    render(saved(textRun));
    const outputs = screen.getByRole("list", { name: "已保存的交付内容" });
    expect(within(outputs).getByText(/包含未结束的思考内容/)).toBeVisible();
    expect(screen.getByText("正文暂时无法核对；复制保留已保存的数据，请核对后使用。")).toBeVisible();
    expect(screen.queryByText(/展示的是整理后的正文/)).not.toBeInTheDocument();
    expect(outputs.textContent).not.toContain("private-unfinished-thinking");
    expect(mocks.clientProps.mock.lastCall?.[0].result.outputs[0].output).toBe(raw);
  });

  it("正文与保存文字相同时不显示整理或复制差异提示", () => {
    const textRun = RunView.parse({ ...run, result: { report: "已核对的业务答复" }, outputContract: { fields: [{ path: "report", label: "业务正文", required: true }] } });
    render(saved(textRun));
    expect(within(screen.getByRole("list", { name: "已保存的交付内容" })).getByText("已核对的业务答复")).toBeVisible();
    expect(screen.queryByText(/展示的是整理后的正文/)).not.toBeInTheDocument();
  });
});
