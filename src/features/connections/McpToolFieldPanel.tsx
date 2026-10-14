"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { SectionReadState } from "@/components/ui/SectionReadState";
import { ToolCatalog, type ToolCatalogFieldRequest } from "@/features/capabilities/ToolCatalog";
import { readToolRegistryDefinitions } from "@/features/capabilities/tool-registry-definition";
import { McpConnectionChecks } from "./McpConnectionChecks";

function FieldScope({ tools }: { tools: ToolRegistryOption[] | null }) {
  const [eligible, setEligible] = useState(true);
  const [request, setRequest] = useState<ToolCatalogFieldRequest | null>(null);
  const mounted = useRef(false);
  const allowed = useRef(true);
  const sequence = useRef(0);
  const fieldToolIds = tools?.filter((tool) => tool.protocol === "mcp-streamable-http").map((tool) => tool.id) ?? [];

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function revoke() {
    allowed.current = false;
    setEligible(false);
    setRequest(null);
  }
  function locate(registryToolId: string) {
    if (!mounted.current || !allowed.current || !fieldToolIds.includes(registryToolId)) return;
    setRequest({ registryToolId, sequence: ++sequence.current });
  }

  return <>
    <McpConnectionChecks fieldToolIds={eligible ? fieldToolIds : []} onLocateFields={locate} onDirectoryReread={revoke} />
    {!eligible && tools !== null && <p role="status" className="rounded-lg bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">连接目录已重新读取，本页原字段说明不再关联当前检查条目。请使用“重新读取状态”更新本页登记字段后核对。</p>}
    {tools === null ? <SectionReadState id="business-tools" title="工具登记定义暂时无法读取" description="不能核对目录数量或字段声明，也不把读取失败当成没有工具。已登记连接的检查入口仍可独立读取；重新读取不会调用业务工具。" /> : <ToolCatalog key={eligible ? "linked" : "unlinked"} tools={tools} definitions={tools} locateRequest={eligible ? request : null} />}
  </>;
}

export function McpToolFieldPanel({ tools, readScope }: { tools: ToolRegistryOption[] | null; readScope: string }) {
  const definitions = readToolRegistryDefinitions(tools);
  const scopeKey = JSON.stringify([readScope, definitions]);
  return <FieldScope key={scopeKey} tools={definitions} />;
}
