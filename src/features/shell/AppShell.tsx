"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity, BadgeCheck, Bell, Bot, BrainCircuit, Building2, CalendarClock, ChevronDown, ChevronRight,
  Database, Globe2, Home, ListChecks, Menu, Network, PlugZap, Plus, Rocket, Settings, ShieldCheck, Sparkles, X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HealthResponse, type Health } from "@/contracts/health";
import { cn } from "@/lib/utils";
import { UsageHelpDialog } from "./UsageHelpDialog";
import { DESKTOP_NAVIGATION, desktopNavigationLocation } from "./desktop-navigation";

type NavigationIcon = (typeof DESKTOP_NAVIGATION)[number]["icon"];

const NAV_ICONS: Record<NavigationIcon, LucideIcon> = {
  home: Home, agents: Bot, runs: Activity, resources: PlugZap, management: Settings,
  attention: Bell, review: ListChecks, schedule: CalendarClock, knowledge: Database,
  connections: PlugZap, models: Network, acceptance: BadgeCheck, release: Rocket,
  web: Globe2, memory: BrainCircuit, harness: ShieldCheck, activity: Activity,
};

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const instanceId = useId();
  const location = desktopNavigationLocation(pathname);
  const [overrides, setOverrides] = useState<Partial<Record<string, boolean>>>({});
  return (
    <nav aria-label="主导航" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <p className="px-3 pb-3 text-[11px] font-semibold tracking-wide text-slate-400">我的工作</p>
      <ul className="space-y-1.5">
        {DESKTOP_NAVIGATION.map((section) => {
          const selected = location.sectionId === section.id;
          const open = overrides[section.id] ?? selected;
          const Icon = NAV_ICONS[section.icon];
          const controls = `${instanceId}-${section.id}`;
          const toggle = () => setOverrides((current) => ({ ...current, [section.id]: !open }));
          const rowStyle = cn("flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600", selected && "bg-indigo-50 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-700");
          const content = <><Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={selected ? 2.2 : 1.8} /><span className="truncate">{section.label}</span></>;
          return (
            <li key={section.id}>
              <div className="flex items-center gap-1">
                {section.href ? <Link href={section.href} aria-current={location.activeHref === section.href ? "page" : undefined} onClick={onNavigate} className={rowStyle}>{content}</Link>
                  : <button type="button" aria-expanded={open} aria-controls={controls} onClick={toggle} className={rowStyle}>{content}<ChevronDown aria-hidden="true" className={cn("ml-auto size-4 shrink-0 transition-transform", !open && "-rotate-90")} /></button>}
                {section.href && section.entries.length > 0 && <button type="button" aria-label={`${open ? "收起" : "展开"}${section.label}子入口`} aria-expanded={open} aria-controls={controls} onClick={toggle} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"><ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", !open && "-rotate-90")} /></button>}
              </div>
              {section.entries.length > 0 && <ul id={controls} hidden={!open} aria-label={`${section.label}子入口`} className="ml-5 mt-1 space-y-1 border-l border-slate-200 pl-3">
                {section.entries.map((entry) => {
                  const EntryIcon = NAV_ICONS[entry.icon];
                  const active = location.activeHref === entry.href;
                  return <li key={entry.href}><Link href={entry.href} aria-current={active ? "page" : undefined} onClick={onNavigate} className={cn("flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-indigo-600", active && "bg-indigo-50 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-700")}><EntryIcon aria-hidden="true" className="size-3.5 shrink-0" /><span>{entry.label}</span></Link></li>;
                })}
              </ul>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex h-[72px] items-center gap-3 border-b border-slate-200/80 px-4">
      <span className="grid size-9 place-items-center rounded-xl bg-indigo-600 text-white shadow-[0_7px_18px_rgba(79,70,229,0.24)]"><Sparkles aria-hidden="true" className="size-[18px]" /></span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-bold text-slate-950">Agent Studio<span className="rounded-md border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">云端版</span></span>
        <span className="mt-0.5 block text-[11px] text-slate-400">让每项 AI 工作有据可验</span>
      </span>
    </Link>
  );
}

function ShellHealth() {
  const [state, setState] = useState<
    | { phase: "checking" }
    | { phase: "unavailable" }
    | { phase: "ready"; health: Health }
  >({ phase: "checking" });
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    fetch("/api/health", { signal: controller.signal })
      .then((response) => response.json())
      .then((value: unknown) => {
        if (!active) return;
        const parsed = HealthResponse.safeParse(value);
        setState(parsed.success ? { phase: "ready", health: parsed.data } : { phase: "unavailable" });
      })
      .catch(() => {
        if (active) setState({ phase: "unavailable" });
      })
      .finally(() => window.clearTimeout(timer));
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, []);

  const display = state.phase === "checking"
    ? { label: "检查中", detail: "正在确认连接与配置", dot: "animate-pulse bg-amber-400" }
    : state.phase === "unavailable"
      ? { label: "状态未知", detail: "暂未读到状态，查看详情", dot: "bg-slate-400" }
      : state.health.ok
        ? { label: "正常", detail: "状态检查通过，业务结果仍需核对", dot: "bg-emerald-500" }
        : { label: "需要检查", detail: "状态检查未全部通过，查看详情", dot: "bg-amber-500" };

  return (
    <div aria-live="polite">
      <Link href="/#system-health" aria-label={`云端运行服务：${display.label}。${display.detail}`} className="block rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition hover:border-slate-300 hover:bg-white">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <span aria-hidden="true" className={cn("size-2 rounded-full", display.dot)} />
          云端运行服务<span className="ml-auto text-[11px] font-medium text-slate-500">{display.label}</span>
        </span>
        <span className="mt-1 block pl-4 text-[10px] leading-4 text-slate-400">{display.detail}</span>
      </Link>
    </div>
  );
}

function SidebarFooter() {
  return (
    <div className="space-y-2 border-t border-slate-200/80 p-3">
      <Link href="/agents/new" className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3 py-3 text-white shadow-[0_8px_20px_rgba(79,70,229,0.20)] transition hover:brightness-105">
        <span className="grid size-8 place-items-center rounded-lg bg-white/15"><Sparkles aria-hidden="true" className="size-4" /></span>
        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">把工作交给 AI</span><span className="mt-0.5 block text-[10px] text-indigo-100">说明目标，或导入已有设计</span></span>
        <ChevronRight aria-hidden="true" className="size-4 text-indigo-100" />
      </Link>
      <ShellHealth />
    </div>
  );
}

function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-slate-200/80 bg-white lg:flex">
      <Brand />
      <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-indigo-100 text-indigo-700"><Building2 aria-hidden="true" className="size-4" /></span>
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">工作环境</span><span className="block text-[10px] leading-4 text-slate-400">身份与成员信息尚未接入</span></span>
      </div>
      <SidebarNav key={pathname} pathname={pathname} />
      <SidebarFooter />
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const location = desktopNavigationLocation(pathname);
  return (
    <div className="product-shell flex min-h-screen bg-slate-100/70 text-slate-900">
      <button type="button" onClick={() => contentRef.current?.focus()} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-indigo-700 focus:shadow-lg">跳到页面内容</button>
      <DesktopSidebar pathname={pathname} />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[58px] items-center gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
            <Dialog.Trigger asChild><button type="button" aria-label="打开导航" className="grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 lg:hidden"><Menu className="size-5" /></button></Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(86vw,300px)] flex-col border-r border-slate-200 bg-white shadow-2xl outline-none">
                <Dialog.Title className="sr-only">主导航</Dialog.Title><Brand />
                <Dialog.Close aria-label="关闭导航" className="absolute right-3 top-4 grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="size-5" /></Dialog.Close>
                <SidebarNav key={pathname} pathname={pathname} onNavigate={() => setMobileOpen(false)} /><SidebarFooter />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <nav aria-label="当前位置" className="min-w-0 overflow-hidden text-xs">
            <ol className="flex min-w-0 items-center gap-2">
              {location.crumbs.map((crumb, index) => <li key={`${index}-${crumb.label}`} className="flex min-w-0 items-center gap-2">
                {index > 0 && <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-slate-300" />}
                {crumb.href ? <Link href={crumb.href} className="truncate text-slate-500 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-indigo-600">{crumb.label}</Link> : <span aria-current={index === location.crumbs.length - 1 ? "page" : undefined} className={cn("truncate", index === location.crumbs.length - 1 ? "font-semibold text-slate-800" : "text-slate-500")}>{crumb.label}</span>}
              </li>)}
            </ol>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/runs/attention" aria-label="任务提醒" className="hidden h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 sm:flex"><Bell className="size-4" />任务提醒</Link>
            <UsageHelpDialog key={pathname} />
            <Link href="/agents/new" className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"><Plus className="size-4" />新建助手</Link>
          </div>
        </header>
        <div ref={contentRef} tabIndex={-1} className="product-main min-h-[calc(100vh-58px)] outline-none">{children}</div>
      </div>
    </div>
  );
}
