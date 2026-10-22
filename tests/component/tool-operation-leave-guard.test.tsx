import { fireEvent, render, screen } from "@testing-library/react";
import Link from "next/link";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_OPERATION_LEAVE_MESSAGE, ToolOperationLeaveGuard } from "@/features/tool-operations/ToolOperationLeaveGuard";

afterEach(() => vi.restoreAllMocks());

describe("未确认工具核对的普通页面离开保护", () => {
  it("未确认时取消离开阻止普通同站导航，允许离开不产生业务请求", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const navigate = vi.fn();
    const fetcher = vi.spyOn(window, "fetch");
    render(<><ToolOperationLeaveGuard locked /><Link href="/runs" onClick={(event) => { event.preventDefault(); navigate(); }}><span>源任务</span></Link></>);
    fireEvent.click(screen.getByText("源任务"));
    expect(confirm).toHaveBeenCalledWith(TOOL_OPERATION_LEAVE_MESSAGE);
    expect(navigate).not.toHaveBeenCalled();
    confirm.mockReturnValue(true); fireEvent.click(screen.getByText("源任务"));
    expect(navigate).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("解锁与卸载会移除保护，不影响后续普通链接", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = <Link href="/runs" onClick={(event: React.MouseEvent) => event.preventDefault()}>运行记录</Link>;
    const view = render(<><ToolOperationLeaveGuard locked />{link}</>);
    view.rerender(<><ToolOperationLeaveGuard locked={false} />{link}</>);
    fireEvent.click(screen.getByText("运行记录")); expect(confirm).not.toHaveBeenCalled();
    view.rerender(<><ToolOperationLeaveGuard locked />{link}</>);
    view.rerender(<>{link}</>);
    fireEvent.click(screen.getByText("运行记录")); expect(confirm).not.toHaveBeenCalled();
  });
  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])("组合键或非主键浏览不会丢失当前请求，不拦截 %#", (options) => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<><ToolOperationLeaveGuard locked /><Link href="/runs" onClick={(event) => event.preventDefault()}>另看任务</Link></>);
    fireEvent.click(screen.getByText("另看任务"), options); expect(confirm).not.toHaveBeenCalled();
  });
  it("本页锚点、下载、新标签和外站链接不被普通应用导航保护误拦截", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<><ToolOperationLeaveGuard locked />
      <a href={window.location.pathname + window.location.search + "#history"} onClick={(event) => event.preventDefault()}>本页历史</a>
      <a href="/report" download onClick={(event) => event.preventDefault()}>下载</a>
      <a href="/runs" target="_blank" onClick={(event) => event.preventDefault()}>新标签</a>
      <a href="https://external.invalid" onClick={(event) => event.preventDefault()}>外站</a>
    </>);
    for (const name of ["本页历史", "下载", "新标签", "外站"]) fireEvent.click(screen.getByText(name));
    expect(confirm).not.toHaveBeenCalled();
  });
});
