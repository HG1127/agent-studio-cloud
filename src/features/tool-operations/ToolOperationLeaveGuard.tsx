"use client";

import { useEffect } from "react";

export const TOOL_OPERATION_LEAVE_MESSAGE = "本次核对结果尚未确认。离开会丢失本页保留的原请求内容，重新打开后须先读取历史。确定离开吗？";

export function ToolOperationLeaveGuard({ locked }: { locked: boolean }) {
  useEffect(() => {
    if (!locked) return;
    const confirmLeave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || (target.pathname === window.location.pathname && target.search === window.location.search)) return;
      if (!window.confirm(TOOL_OPERATION_LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", confirmLeave, true);
    return () => document.removeEventListener("click", confirmLeave, true);
  }, [locked]);
  return null;
}
