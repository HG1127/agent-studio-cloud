"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  content: ReactNode;
};

type WorkspaceTabsProps = {
  label: string;
  tabs: WorkspaceTab[];
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

export function WorkspaceTabs({ label, tabs, defaultValue, value, onValueChange, className }: WorkspaceTabsProps) {
  const baseId = useId();
  const [selected, setSelected] = useState(defaultValue ?? tabs[0]?.id ?? "");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const requested = value ?? selected;
  const activeId = tabs.some((tab) => tab.id === requested) ? requested : tabs[0]?.id;

  function select(next: string) {
    if (value === undefined) setSelected(next);
    onValueChange?.(next);
  }

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(tabs[next].id);
    tabRefs.current[next]?.focus();
  }

  if (tabs.length === 0) return null;

  return <div className={cn("min-w-0 space-y-5", className)}>
    <div role="tablist" aria-label={label} className="flex min-w-0 flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((tab, index) => <button key={tab.id} ref={(element) => { tabRefs.current[index] = element; }} type="button"
        id={baseId + "-tab-" + index} role="tab" aria-selected={activeId === tab.id} aria-controls={baseId + "-panel-" + index}
        tabIndex={activeId === tab.id ? 0 : -1} onClick={() => select(tab.id)} onKeyDown={(event) => navigate(event, index)}
        className={cn("relative inline-flex min-h-12 items-center gap-2 rounded-t-lg px-4 py-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400",
          activeId === tab.id ? "bg-indigo-50/70 text-indigo-700 after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-indigo-600" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900")}>
        {tab.icon ? <span aria-hidden="true" className="shrink-0">{tab.icon}</span> : null}{tab.label}
      </button>)}
    </div>
    {tabs.map((tab, index) => <div key={tab.id} id={baseId + "-panel-" + index} role="tabpanel"
      aria-labelledby={baseId + "-tab-" + index} aria-describedby={tab.description ? baseId + "-description-" + index : undefined}
      hidden={activeId !== tab.id} tabIndex={0} className="min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-indigo-200">
      {tab.description ? <p id={baseId + "-description-" + index} className="mb-4 text-sm leading-6 text-slate-500">{tab.description}</p> : null}
      {tab.content}
    </div>)}
  </div>;
}
