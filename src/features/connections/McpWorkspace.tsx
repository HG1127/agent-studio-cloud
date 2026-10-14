"use client";

import type { ReactNode } from "react";
import { ClipboardPen, PlugZap, Workflow } from "lucide-react";
import { WorkspaceTabs } from "@/components/ui/WorkspaceTabs";
import { McpConnectionDesignDraft } from "./McpConnectionDesignDraft";

export function McpWorkspace({ registered, usage }: { registered: ReactNode; usage?: ReactNode }) {
  return <WorkspaceTabs label="外部连接功能" defaultValue="registered" tabs={[
    { id: "registered", label: "登记与检查", icon: <PlugZap className="size-4" />,
      description: "读取服务端真实登记，按需检查连接与工具定义；不会自动调用业务工具或更改授权。",
      content: <div className="space-y-5">{registered}</div> },
    { id: "design", label: "连接设计", icon: <ClipboardPen className="size-4" />,
      description: "先整理连接、认证引用和业务边界方案。填写仅在本页保留，尚未保存或生效。",
      content: <McpConnectionDesignDraft /> },
    ...(usage ? [{ id: "usage", label: "使用与影响", icon: <Workflow className="size-4" />,
      description: "选择真实登记工具，核对使用边界并进入助手流程设计；账号授权与失效影响单独核对，不根据登记推定可用。",
      content: usage }] : []),
  ]} />;
}
