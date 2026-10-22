"use client";

import { Globe2, PanelsTopLeft } from "lucide-react";
import type { AgentTargetOption } from "@/contracts/agent";
import { WorkspaceTabs } from "@/components/ui/WorkspaceTabs";
import { PublishedToolManager } from "./PublishedToolManager";
import { WebToolDesignStudio } from "./WebToolDesignStudio";

export function WebToolsWorkspace({ targets }: { targets: AgentTargetOption[] | null }) {
  return <WorkspaceTabs label="网页工具功能" defaultValue="manage" tabs={[
    { id: "manage", label: "工具管理", icon: <Globe2 className="size-4" />, content: <PublishedToolManager targets={targets} /> },
    { id: "design", label: "页面设计", icon: <PanelsTopLeft className="size-4" />, content: <WebToolDesignStudio targets={targets} /> },
  ]} />;
}
