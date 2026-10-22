type NavigationIcon = "home" | "agents" | "runs" | "resources" | "management" | "attention" | "review" | "schedule" | "knowledge" | "connections" | "models" | "acceptance" | "release" | "web" | "memory" | "harness" | "activity";
type NavigationEntry = { href: string; label: string; icon: NavigationIcon };
type NavigationSection = { id: string; label: string; icon: NavigationIcon; href?: string; entries: readonly NavigationEntry[] };
type NavigationCrumb = { label: string; href?: string };

export const DESKTOP_NAVIGATION: readonly NavigationSection[] = [
  { id: "home", label: "工作台", icon: "home", href: "/", entries: [] },
  { id: "agents", label: "我的助手", icon: "agents", href: "/agents", entries: [] },
  { id: "operations", label: "处理记录", icon: "runs", href: "/runs", entries: [
    { href: "/runs/attention", label: "待处理任务", icon: "attention" },
    { href: "/tool-operations", label: "工具结果核对", icon: "review" },
    { href: "/schedules", label: "定时任务", icon: "schedule" },
  ] },
  { id: "resources", label: "资料与应用", icon: "resources", entries: [
    { href: "/knowledge", label: "知识库", icon: "knowledge" },
    { href: "/connections", label: "外部工具连接", icon: "connections" },
    { href: "/settings", label: "模型连接", icon: "models" },
  ] },
  { id: "management", label: "管理设置", icon: "management", entries: [
    { href: "/acceptance", label: "验收中心", icon: "acceptance" },
    { href: "/releases", label: "发布中心", icon: "release" },
    { href: "/web-tools", label: "网页工具", icon: "web" },
    { href: "/memory", label: "共享经验", icon: "memory" },
    { href: "/harness", label: "运行控制台", icon: "harness" },
    { href: "/activity", label: "操作记录", icon: "activity" },
  ] },
];

function matches(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

export function desktopNavigationLocation(pathname: string): { sectionId: string | null; activeHref: string | null; title: string; crumbs: NavigationCrumb[] } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const section = DESKTOP_NAVIGATION.find((item) => item.entries.some((entry) => matches(path, entry.href)) || (item.href !== undefined && matches(path, item.href)));
  const home: NavigationCrumb = { label: "工作台", href: "/" };
  if (!section) return { sectionId: null, activeHref: null, title: "当前页面", crumbs: [home, { label: "当前页面" }] };
  if (section.id === "home") return { sectionId: section.id, activeHref: "/", title: "工作台", crumbs: [{ label: "工作台" }] };
  const entry = section.entries.find((item) => matches(path, item.href));
  const activeHref = entry?.href ?? section.href ?? null;
  const crumbs: NavigationCrumb[] = [home];
  const current = entry?.label ?? section.label;
  if (entry) crumbs.push({ label: section.label, href: section.href });
  let title = current;
  if (section.id === "agents" && path !== "/agents") {
    crumbs.push({ label: section.label, href: section.href });
    const version = /^\/agents\/([^/]+)\/versions\/([^/]+)$/.exec(path);
    if (version) {
      crumbs.push({ label: "助手工作台", href: `/agents/${version[1]}` });
      title = version[2] === "compare" ? "版本对比" : "冻结版本核对";
    } else title = path === "/agents/new" ? "新建助手" : "助手工作台";
  } else if (section.id === "operations" && !entry && path !== "/runs") {
    crumbs.push({ label: section.label, href: section.href });
    title = "运行详情";
  }
  crumbs.push({ label: title });
  return { sectionId: section.id, activeHref, title, crumbs };
}
