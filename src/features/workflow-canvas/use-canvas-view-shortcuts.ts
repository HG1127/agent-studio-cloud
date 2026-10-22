"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { WorkflowFlowNode } from "./CustomNodes";
import { canvasViewShortcut, isCanvasViewShortcutContext } from "./canvas-view-shortcuts";

type CanvasViewOwner = { scope: unknown };

export function useCanvasViewShortcuts(scope: unknown, canvas: RefObject<HTMLElement | null>, flow: RefObject<ReactFlowInstance<WorkflowFlowNode, Edge> | null>) {
  const owner = useRef<CanvasViewOwner | null>(null);
  const [surface, setSurface] = useState<{ container: HTMLElement | null; instance: ReactFlowInstance<WorkflowFlowNode, Edge> | null }>({ container: null, instance: null });
  const scopeOwner = useMemo(() => ({ scope, surface }), [scope, surface]);
  const request = useRef(0);
  const [failure, setFailure] = useState<{ owner: CanvasViewOwner; message: string } | null>(null);
  const onCanvasRef = useCallback((container: HTMLElement | null) => {
    if (canvas.current === container) return;
    canvas.current = container;
    flow.current = null;
    setSurface({ container, instance: null });
  }, [canvas, flow]);
  const onViewInit = useCallback((instance: ReactFlowInstance<WorkflowFlowNode, Edge> | null) => {
    const container = surface.container;
    if (!container || canvas.current !== container || !container.isConnected) return;
    flow.current = instance;
    setSurface((current) => current.instance === instance ? current : { ...current, instance });
  }, [canvas, flow, surface.container]);
  useLayoutEffect(() => {
    const current = scopeOwner;
    owner.current = current;
    return () => { if (owner.current === current) owner.current = null; request.current += 1; };
  }, [scopeOwner]);

  function onViewKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return;
    const container = canvas.current;
    const command = canvasViewShortcut(event.nativeEvent, isCanvasViewShortcutContext(container, event.target, container?.ownerDocument.activeElement ?? null));
    const instance = flow.current;
    const current = owner.current;
    if (!command || !container || !instance || current !== scopeOwner || surface.container !== container || surface.instance !== instance) return;
    event.preventDefault();
    const token = ++request.current;
    setFailure(null);
    void (async () => {
      const isCurrent = () => owner.current === current && request.current === token && flow.current === instance && canvas.current === container && container.isConnected;
      try {
        const changed = await (command === "zoom-in" ? instance.zoomIn({ duration: 200 })
          : command === "zoom-out" ? instance.zoomOut({ duration: 200 })
            : instance.fitView({ padding: 0.18, duration: 250 }));
        if (!changed && isCurrent()) setFailure({ owner: current, message: "画布尚未准备好，暂未调整视图。请稍后重试，流程内容没有改变。" });
      } catch {
        if (isCurrent()) setFailure({ owner: current, message: "暂时无法调整画布视图，请稍后重试。流程内容没有改变。" });
      }
    })();
  }

  return { onCanvasRef, onViewInit, onViewKeyDown, canvasMounted: surface.container !== null, viewError: failure && failure.owner === scopeOwner ? failure.message : null };
}
