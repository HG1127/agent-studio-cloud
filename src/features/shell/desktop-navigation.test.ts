import { describe, expect, it } from "vitest";
import { DESKTOP_NAVIGATION, desktopNavigationLocation } from "./desktop-navigation";

describe("V5.7桌面入口归属", () => {
  it("保留五个一级入口及全部真实旧链接，不提供不存在的管理页", () => {
    expect(DESKTOP_NAVIGATION.map((section) => section.label)).toEqual(["工作台", "我的助手", "处理记录", "资料与应用", "管理设置"]);
    const hrefs = DESKTOP_NAVIGATION.flatMap((section) => [...(section.href ? [section.href] : []), ...section.entries.map((entry) => entry.href)]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(15);
    expect(hrefs).toEqual(expect.arrayContaining(["/", "/agents", "/runs", "/runs/attention", "/tool-operations", "/schedules", "/knowledge", "/connections", "/settings", "/acceptance", "/releases", "/web-tools", "/memory", "/harness", "/activity"]));
    expect(DESKTOP_NAVIGATION.find((section) => section.id === "management")?.href).toBeUndefined();
  });
  it.each([
    ["/", "home", "/", "工作台"], ["/agents", "agents", "/agents", "我的助手"],
    ["/agents/new", "agents", "/agents", "新建助手"], ["/agents/real-agent", "agents", "/agents", "助手工作台"],
    ["/agents/real-agent/versions/real-version", "agents", "/agents", "冻结版本核对"],
    ["/agents/real-agent/versions/compare", "agents", "/agents", "版本对比"],
    ["/runs", "operations", "/runs", "处理记录"], ["/runs/real-run", "operations", "/runs", "运行详情"],
    ["/runs/attention", "operations", "/runs/attention", "待处理任务"],
    ["/tool-operations", "operations", "/tool-operations", "工具结果核对"], ["/schedules", "operations", "/schedules", "定时任务"],
    ["/knowledge", "resources", "/knowledge", "知识库"], ["/connections", "resources", "/connections", "外部工具连接"],
    ["/settings", "resources", "/settings", "模型连接"],
    ["/acceptance", "management", "/acceptance", "验收中心"], ["/releases", "management", "/releases", "发布中心"],
    ["/web-tools", "management", "/web-tools", "网页工具"], ["/memory", "management", "/memory", "共享经验"],
    ["/harness", "management", "/harness", "运行控制台"], ["/activity", "management", "/activity", "操作记录"],
  ])("%s的选中和当前位置使用同一来源", (path, sectionId, activeHref, title) => {
    const location = desktopNavigationLocation(path);
    expect(location).toMatchObject({ sectionId, activeHref, title });
    expect(location.crumbs.at(-1)).toEqual({ label: title });
  });
  it("版本页面提供真正的助手返回路径，不在文案中暴露内部编号", () => {
    const location = desktopNavigationLocation("/agents/private-agent/versions/private-version");
    expect(location.crumbs).toEqual([{ label: "工作台", href: "/" }, { label: "我的助手", href: "/agents" }, { label: "助手工作台", href: "/agents/private-agent" }, { label: "冻结版本核对" }]);
    expect(location.crumbs.map((crumb) => crumb.label).join(" ")).not.toMatch(/private-agent|private-version/);
  });
  it.each(["/runship", "/agents-other", "/unknown", "/knowledge-base"])("不把相似前缀%s误选为真实页面", (path) => {
    expect(desktopNavigationLocation(path)).toMatchObject({ sectionId: null, activeHref: null, title: "当前页面" });
  });
  it("尾部斜线不改变当前入口归属", () => {
    expect(desktopNavigationLocation("/connections/")).toEqual(desktopNavigationLocation("/connections"));
  });
});
