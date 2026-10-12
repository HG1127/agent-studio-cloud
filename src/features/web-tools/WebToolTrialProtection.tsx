"use client";

import { useEffect } from "react";

export const WEB_TOOL_TRIAL_LEAVE_MESSAGE = "这次试运行正在创建或结果尚未确认。离开会丢失本页保留的原请求，不能取消后台任务。重新打开后请先查看运行记录，不要按新请求重复提交。确定离开吗？";

export function WebToolTrialProtection({ isLocked, onLeave }: { isLocked: () => boolean; onLeave: () => void }) {
  useEffect(() => {
    const originalLocation = window.location.pathname + window.location.search;
    const confirmLeave = (event: Event) => {
      if (!isLocked()) return;
      if (!window.confirm(WEB_TOOL_TRIAL_LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onLeave();
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      if (!["http:", "https:"].includes(target.protocol)) return;
      if (target.origin === window.location.origin && target.pathname + target.search === window.location.pathname + window.location.search) return;
      confirmLeave(event);
    };
    const submit = (event: SubmitEvent) => {
      if (event.defaultPrevented || !(event.target instanceof HTMLFormElement) || !event.target.hasAttribute("data-web-tool-version-form")) return;
      confirmLeave(event);
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (!isLocked()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const history = () => {
      if (window.location.pathname + window.location.search !== originalLocation) onLeave();
    };
    document.addEventListener("click", click, true);
    document.addEventListener("submit", submit, true);
    window.addEventListener("beforeunload", unload);
    window.addEventListener("popstate", history);
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("submit", submit, true);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("popstate", history);
    };
  }, [isLocked, onLeave]);
  return null;
}
