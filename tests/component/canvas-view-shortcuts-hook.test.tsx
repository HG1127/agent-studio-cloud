import { act, fireEvent, render, screen } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowFlowNode } from "@/features/workflow-canvas/CustomNodes";
import { useCanvasViewShortcuts } from "@/features/workflow-canvas/use-canvas-view-shortcuts";

function viewMethods() {
  return { zoomIn: vi.fn().mockResolvedValue(true), zoomOut: vi.fn().mockResolvedValue(true), fitView: vi.fn().mockResolvedValue(true) };
}

function Harness({ scope, methods, canvasKey = "canvas", autoInit = true, captureInit }: {
  scope: string; methods: ReturnType<typeof viewMethods> | null; canvasKey?: string; autoInit?: boolean;
  captureInit?: (init: ReturnType<typeof useCanvasViewShortcuts>["onViewInit"]) => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useRef<ReactFlowInstance<WorkflowFlowNode, Edge> | null>(null);
  const { onCanvasRef, onViewInit, onViewKeyDown, viewError } = useCanvasViewShortcuts(scope, canvas, flow);
  useLayoutEffect(() => {
    captureInit?.(onViewInit);
    if (autoInit) onViewInit(methods as unknown as ReactFlowInstance<WorkflowFlowNode, Edge> | null);
  }, [autoInit, captureInit, methods, onViewInit]);
  return <div><div key={canvasKey} ref={onCanvasRef} tabIndex={0} aria-label="测试画布视图" onKeyDown={onViewKeyDown}>
    <button type="button">步骤焦点</button><input aria-label="画布内填写" />
  </div><input aria-label="画布外填写" />{viewError ? <p role="status">{viewError}</p> : null}</div>;
}

function deferred() {
  let resolve!: (changed: boolean) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<boolean>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("画布视图快捷键回执（视图方法为 I/O 替身，不代表真实画布验收）", () => {
  it("真实焦点和 React 键盘事件只调用对应视图方法", async () => {
    const methods = viewMethods();
    render(<Harness scope="draft" methods={methods} />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    expect(fireEvent.keyDown(canvas, { key: "+", shiftKey: true })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "=", ctrlKey: true })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "-", metaKey: true })).toBe(false);
    expect(fireEvent.keyDown(canvas, { key: "0" })).toBe(false);
    expect(methods.zoomIn).toHaveBeenCalledTimes(2);
    expect(methods.zoomOut).toHaveBeenCalledOnce();
    expect(methods.fitView).toHaveBeenCalledOnce();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("实例未准备、填写、外部焦点和输入法组合不拦截键盘", () => {
    const methods = viewMethods();
    const view = render(<Harness scope="draft" methods={null} />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    expect(fireEvent.keyDown(canvas, { key: "+" })).toBe(true);
    view.rerender(<Harness scope="draft" methods={methods} />);
    const inside = screen.getByLabelText("画布内填写");
    inside.focus();
    expect(fireEvent.keyDown(inside, { key: "0", ctrlKey: true })).toBe(true);
    screen.getByLabelText("画布外填写").focus();
    expect(fireEvent.keyDown(canvas, { key: "+" })).toBe(true);
    canvas.focus();
    expect(fireEvent.keyDown(canvas, { key: "+", isComposing: true })).toBe(true);
    expect(methods.zoomIn).not.toHaveBeenCalled();
    expect(methods.zoomOut).not.toHaveBeenCalled();
    expect(methods.fitView).not.toHaveBeenCalled();
  });

  it("方法明确未完成或抛错时只提示视图问题，不声称已完成", async () => {
    const methods = viewMethods();
    methods.fitView.mockResolvedValueOnce(false);
    methods.zoomIn.mockRejectedValueOnce(new Error("private-internal-detail"));
    render(<Harness scope="draft" methods={methods} />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    await act(async () => { fireEvent.keyDown(canvas, { key: "0" }); });
    expect(screen.getByRole("status")).toHaveTextContent("暂未调整视图");
    await act(async () => { fireEvent.keyDown(canvas, { key: "+" }); });
    expect(screen.getByRole("status")).toHaveTextContent("暂时无法调整画布视图");
    expect(screen.getByRole("status")).not.toHaveTextContent("private-internal-detail");
  });

  it("新视图操作完成后，旧操作的迟到失败不能覆盖当前反馈", async () => {
    const methods = viewMethods();
    const old = deferred();
    methods.zoomIn.mockReturnValueOnce(old.promise);
    render(<Harness scope="draft" methods={methods} />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "+" });
    await act(async () => { fireEvent.keyDown(canvas, { key: "0" }); });
    await act(async () => { old.reject(new Error("late")); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("换范围后回到原范围，不恢复旧错误或旧操作的迟到回执", async () => {
    const methods = viewMethods();
    methods.fitView.mockResolvedValueOnce(false);
    const old = deferred();
    methods.zoomIn.mockReturnValueOnce(old.promise);
    const view = render(<Harness scope="one" methods={methods} />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    await act(async () => { fireEvent.keyDown(canvas, { key: "0" }); });
    expect(screen.getByRole("status")).toHaveTextContent("暂未调整视图");
    fireEvent.keyDown(canvas, { key: "+" });
    view.rerender(<Harness scope="two" methods={methods} />);
    view.rerender(<Harness scope="one" methods={methods} />);
    await act(async () => { old.resolve(false); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("画布实例替换或卸载后，旧视图请求不产生反馈", async () => {
    const methods = viewMethods();
    const replaced = deferred();
    const removed = deferred();
    methods.zoomIn.mockReturnValueOnce(replaced.promise);
    const view = render(<Harness scope="draft" methods={methods} />);
    let canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "+" });
    const next = viewMethods();
    next.zoomOut.mockReturnValueOnce(removed.promise);
    view.rerender(<Harness scope="draft" methods={next} />);
    await act(async () => { replaced.resolve(false); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "-" });
    view.unmount();
    await act(async () => { removed.reject(new Error("unmounted")); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("同范围的画布容器重建时，旧容器请求不能污染新画布", async () => {
    const methods = viewMethods();
    const old = deferred();
    methods.fitView.mockReturnValueOnce(old.promise);
    const view = render(<Harness scope="draft" methods={methods} canvasKey="old" />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "0" });
    view.rerender(<Harness scope="draft" methods={methods} canvasKey="new" />);
    expect(screen.getByLabelText("测试画布视图")).not.toBe(canvas);
    await act(async () => { old.resolve(false); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each(["container", "instance"] as const)("已显示视图错误后，同范围%s换代不沿用旧错误", async (changed) => {
    const methods = viewMethods();
    methods.fitView.mockResolvedValueOnce(false);
    const view = render(<Harness scope="draft" methods={methods} canvasKey="old" />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    await act(async () => { fireEvent.keyDown(canvas, { key: "0" }); });
    expect(screen.getByRole("status")).toHaveTextContent("暂未调整视图");
    view.rerender(<Harness scope="draft" methods={changed === "instance" ? viewMethods() : methods} canvasKey={changed === "container" ? "new" : "old"} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("新容器未初始化时不调用旧画布实例，也不拦截查看按键", () => {
    const methods = viewMethods();
    const view = render(<Harness scope="draft" methods={methods} canvasKey="old" />);
    view.rerender(<Harness scope="draft" methods={methods} canvasKey="new" autoInit={false} />);
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    expect(fireEvent.keyDown(canvas, { key: "+" })).toBe(true);
    expect(methods.zoomIn).not.toHaveBeenCalled();
  });

  it("旧容器迟到的初始化回调不能覆盖已准备好的新实例", async () => {
    const old = viewMethods();
    const current = viewMethods();
    const capture = vi.fn<(init: ReturnType<typeof useCanvasViewShortcuts>["onViewInit"]) => void>();
    const view = render(<Harness scope="draft" methods={old} canvasKey="old" captureInit={capture} />);
    const lateInit = capture.mock.calls.at(-1)![0];
    view.rerender(<Harness scope="draft" methods={current} canvasKey="new" captureInit={capture} />);
    act(() => { lateInit(old as unknown as ReactFlowInstance<WorkflowFlowNode, Edge>); });
    const canvas = screen.getByLabelText("测试画布视图");
    canvas.focus();
    await act(async () => { fireEvent.keyDown(canvas, { key: "+" }); });
    expect(current.zoomIn).toHaveBeenCalledOnce();
    expect(old.zoomIn).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
