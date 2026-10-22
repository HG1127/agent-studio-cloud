"use client";

import { useState, type ReactNode } from "react";
import { RunSectionUnavailable } from "./RunSectionUnavailable";

export function RunFeedbackReadBoundary({ readable, children }: { readable: boolean; children: ReactNode }) {
  const [previous, setPrevious] = useState(children);
  if (readable && previous !== children) setPrevious(children);
  const content = readable ? children : previous;

  return <div className="min-w-0 space-y-3">
    {!readable ? <section className="content-card"><h2 className="text-sm font-semibold">结果反馈</h2><RunSectionUnavailable title="已保存反馈暂时无法读取" message={content ? "已有表单内容暂时保留，但记录尚未重新核对；反馈输入和提交暂时停用。最终结果仍可查看与复制，请先重新读取状态。" : "当前不提交新评价或加入样例，避免覆盖未知的已有反馈。最终结果仍可查看与复制，请先重新读取并核对。"} /></section> : null}
    {content ? <fieldset disabled={!readable} aria-label={!readable ? "暂存的结果反馈" : "结果反馈操作"} className="min-w-0">{content}</fieldset> : null}
  </div>;
}
