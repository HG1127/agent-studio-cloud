"use client";

import { useEffect, useRef } from "react";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";

const LEAVE_MESSAGE = "页面还有未保存修改，确定离开当前页面吗？";

function navigatesWithinApp(anchor: HTMLAnchorElement): boolean {
  if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return false;
  const target = new URL(anchor.href, window.location.href);
  if (target.origin !== window.location.origin) return false;
  return target.href !== window.location.href;
}

export function DraftNavigationGuard() {
  const dirtyAgents = useRef(new Set<string>());

  useEffect(() => {
    const receiveDraftState = (event: Event) => {
      const detail = (event as CustomEvent<DraftStateDetail>).detail;
      if (!detail?.agentId) return;
      if (detail.dirty) dirtyAgents.current.add(detail.agentId);
      else dirtyAgents.current.delete(detail.agentId);
    };
    const guardNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
        || dirtyAgents.current.size === 0
      ) return;
      const target = event.target;
      const anchor = target instanceof Element ? target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || !navigatesWithinApp(anchor)) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener(DRAFT_STATE_EVENT, receiveDraftState);
    document.addEventListener("click", guardNavigation, true);
    return () => {
      window.removeEventListener(DRAFT_STATE_EVENT, receiveDraftState);
      document.removeEventListener("click", guardNavigation, true);
    };
  }, []);

  return null;
}
