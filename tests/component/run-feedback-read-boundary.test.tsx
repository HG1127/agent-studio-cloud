import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { RunFeedbackReadBoundary } from "@/features/runs/RunFeedbackReadBoundary";

function FeedbackForm({ submit }: { submit: () => void }) {
  const [note, setNote] = useState("原评价");
  return <form onSubmit={(event) => { event.preventDefault(); submit(); }}><label>改进说明<input value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="submit">保存反馈</button></form>;
}

describe("结果反馈读取边界", () => {
  it("首次读取失败只说明未知，不创建空表单或写入口", () => {
    render(<RunFeedbackReadBoundary readable={false}>{null}</RunFeedbackReadBoundary>);
    expect(screen.getByRole("alert")).toHaveTextContent("避免覆盖未知的已有反馈");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("同一任务读取失败保留已编辑内容但停止提交，重新读到后仍可继续编辑", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    const { rerender } = render(<RunFeedbackReadBoundary key="same-run" readable><FeedbackForm submit={submit} /></RunFeedbackReadBoundary>);
    await user.clear(screen.getByRole("textbox", { name: "改进说明" }));
    await user.type(screen.getByRole("textbox", { name: "改进说明" }), "尚未保存的核对意见");
    rerender(<RunFeedbackReadBoundary key="same-run" readable={false}>{null}</RunFeedbackReadBoundary>);
    expect(screen.getByRole("textbox", { name: "改进说明" })).toHaveValue("尚未保存的核对意见");
    expect(screen.getByRole("textbox", { name: "改进说明" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "保存反馈" }));
    expect(submit).not.toHaveBeenCalled();
    rerender(<RunFeedbackReadBoundary key="same-run" readable><FeedbackForm submit={submit} /></RunFeedbackReadBoundary>);
    expect(screen.getByRole("textbox", { name: "改进说明" })).toHaveValue("尚未保存的核对意见");
    expect(screen.getByRole("button", { name: "保存反馈" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "保存反馈" }));
    expect(submit).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("切换任务时不带入前一个任务的暂存表单", () => {
    const { rerender } = render(<RunFeedbackReadBoundary key="first-run" readable><FeedbackForm submit={vi.fn()} /></RunFeedbackReadBoundary>);
    rerender(<RunFeedbackReadBoundary key="next-run" readable={false}>{null}</RunFeedbackReadBoundary>);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("已有表单内容暂时保留")).not.toBeInTheDocument();
  });
});
