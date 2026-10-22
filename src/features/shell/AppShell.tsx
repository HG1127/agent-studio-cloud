"use client";

import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity, BadgeCheck, Bell, Bot, BrainCircuit, CalendarClock, ChevronRight,
  CircleHelp, Database, Globe2, Home, ListChecks, Menu, Network, PlugZap, Plus, Rocket, Settings, ShieldCheck, Sparkles, X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { HealthResponse, type Health } from "@/contracts/health";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  { label: "我的工作", items: [
    { href: "/", label: "总览", icon: Home },
    { href: "/agents", label: "助手", icon: Bot },
    { href: "/runs", label: "运行记录", icon: Activity },
    { href: "/tool-operations", label: "工具结果核对", icon: ListChecks },
    { href: "/knowledge", label: "知识库", icon: Database },
  ] },
  { label: "品质与发布", items: [
    { href: "/acceptance", label: "验收中心", icon: BadgeCheck },
    { href: "/releases", label: "发布中心", icon: Rocket },
    { href: "/web-tools", label: "网页工具", icon: Globe2 },
    { href: "/memory", label: "经验库", icon: BrainCircuit },
    { href: "/schedules", label: "定时任务", icon: CalendarClock },
  ] },
  { label: "工作区", items: [
    { href: "/harness", label: "运行诊断", icon: ShieldCheck },
    { href: "/connections", label: "外部工具连接", icon: PlugZap },
    { href: "/settings", label: "模型连接", icon: Network },
    { href: "/activity", label: "操作记录", icon: Settings },
  ] },
];

const ROUTE_LABELS: Array<[string, string]> = [
  ["/agents/", "助手工作台"], ["/agents", "我的助手"], ["/runs/", "运行详情"],
  ["/runs", "运行中心"], ["/knowledge", "资料与应用"], ["/memory", "成长中心"],
  ["/tool-operations", "工具结果人工核对"],
  ["/acceptance", "验收中心"], ["/releases", "发布中心"], ["/schedules", "定时任务"],
  ["/harness", "运行控制台"], ["/web-tools", "网页工具"], ["/connections", "外部工具连接"],
  ["/settings", "管理设置"], ["/activity", "操作记录"], ["/", "工作台"],
];

function routeLabel(pathname: string) {
  if (pathname === "/agents/new") return "创建助手";
  if (pathname === "/runs/attention") return "待处理任务";
  if (/^\/agents\/[^/]+\/versions\/compare$/.test(pathname)) return "版本对比";
  if (/^\/agents\/[^/]+\/versions\/[^/]+$/.test(pathname) && !pathname.endsWith("/compare")) return "冻结版本核对";
  return ROUTE_LABELS.find(([route]) => route === "/" ? pathname === "/" : pathname.startsWith(route))?.[1] ?? "工作台";
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wide text-slate-400">{group.label}</p>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} onClick={onNavigate}
                  className={cn("group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950", active && "bg-indigo-50 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-700")}>
                  <Icon aria-hidden="true" className={cn("size-[17px] text-slate-400 group-hover:text-slate-700", active && "text-indigo-600")} strokeWidth={active ? 2.2 : 1.8} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
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
        ? { label: "正常", detail: "任务与数据按工作区隔离保存", dot: "bg-emerald-500" }
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
        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">把工作交给 AI</span><span className="mt-0.5 block text-[10px] text-indigo-100">说目标，自动生成流程</span></span>
        <ChevronRight aria-hidden="true" className="size-4 text-indigo-100" />
      </Link>
      <ShellHealth />
      <div className="flex items-center gap-3 rounded-xl px-2 py-2">
        <span className="grid size-8 place-items-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">工</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">当前工作区</span><span className="block text-[10px] text-slate-400">工作区成员</span></span>
      </div>
    </div>
  );
}

function DesktopSidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-slate-200/80 bg-white lg:flex">
      <Brand />
      <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-indigo-100 text-xs font-bold text-indigo-700">A</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">Agent Studio 工作区</span><span className="block text-[10px] text-slate-400">云端工作区</span></span>
      </div>
      <SidebarNav pathname={pathname} />
      <SidebarFooter />
    </aside>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="product-shell flex min-h-screen bg-slate-100/70 text-slate-900">
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
                <SidebarNav pathname={pathname} onNavigate={() => setMobileOpen(false)} /><SidebarFooter />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
          <nav aria-label="当前位置" className="flex min-w-0 items-center gap-2 text-xs">
            <Link href="/" className="hidden text-slate-400 hover:text-slate-700 sm:inline">Agent Studio</Link><span className="hidden text-slate-300 sm:inline">/</span><span aria-current="page" className="truncate font-semibold text-slate-800">{routeLabel(pathname)}</span>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/runs/attention" aria-label="任务提醒" className="hidden h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 sm:flex"><Bell className="size-4" />任务提醒</Link>
            <Link href="/activity" aria-label="查看帮助与操作记录" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><CircleHelp className="size-4" /></Link>
            <Link href="/agents/new" className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"><Plus className="size-4" />新建助手</Link>
          </div>
        </header>
        <div className="product-main min-h-[calc(100vh-58px)]">{children}</div>
      </div>
    </div>
  );
}
