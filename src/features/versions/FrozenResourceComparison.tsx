"use client";

import { useId } from "react";
import type { VersionSummary } from "@/contracts/version";
import { FrozenResourceBindings } from "./FrozenResourceBindings";
import type { FrozenResourceBindingsView } from "./frozen-resource-bindings";

function versionLabel(version: VersionSummary["version"]): string {
  return Number.isSafeInteger(version) ? "版本 " + version : "版本序号待核对";
}

export function FrozenResourceComparison({ beforeView, afterView, beforeVersion, afterVersion }: {
  beforeView: FrozenResourceBindingsView;
  afterView: FrozenResourceBindingsView;
  beforeVersion: VersionSummary["version"];
  afterVersion: VersionSummary["version"];
}) {
  const headingId = useId();
  const sides = [
    { label: "前一份", view: beforeView, version: beforeVersion },
    { label: "后一份", view: afterView, version: afterVersion },
  ];
  return <section aria-labelledby={headingId} className="min-w-0 space-y-4">
    <div className="content-card min-w-0">
      <h2 id={headingId} className="section-title">两个版本的资源声明核对</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">按对比顺序分别展示两份已保存记录。相同显示名称不能证明资源相同或执行一致。</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">声明内容不代表授权、当前可用、运行结果或审批通过。任一份范围未知时，另一份仍可独立核对。</p>
    </div>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
      {sides.map((side, index) => <section key={side.label} aria-labelledby={headingId + "-" + index}
        className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 [&_.grid]:grid-cols-1">
        <h3 id={headingId + "-" + index} className="break-words text-base font-semibold text-slate-900">
          {side.label} · {versionLabel(side.version)}
        </h3>
        <FrozenResourceBindings view={side.view} collapsible />
      </section>)}
    </div>
  </section>;
}
