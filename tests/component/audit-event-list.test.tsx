import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditEventList } from "@/features/activity/AuditEventList";

describe("操作记录列表", () => {
  it("区分工作区尚无记录与筛选无结果", () => {
    const { rerender } = render(<AuditEventList events={[]} />);
    expect(screen.getByText("还没有操作记录")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看全部记录" })).not.toBeInTheDocument();

    rerender(<AuditEventList events={[]} filtered />);
    expect(screen.getByText("没有符合筛选条件的操作记录")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看全部记录" })).toHaveAttribute("href", "/activity");
  });

  it("高页码为空时不误称历史不存在，回到第一页保留类型与关键词", () => {
    render(<AuditEventList events={[]} filtered page={999} filters={{ targetType: "agent", query: "发布" }} />);
    expect(screen.getByText("当前页没有操作记录")).toBeInTheDocument();
    expect(screen.queryByText("没有符合筛选条件的操作记录")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "回到第一页" })).toHaveAttribute("href", "/activity?type=agent&q=%E5%8F%91%E5%B8%83");
  });

  it("用中文标签展示知识、经验、验收与运行反馈变更", () => {
    render(<AuditEventList events={[
      {
        id: "00000000-0000-4000-8000-000000000001",
        action: "knowledge.archived",
        targetType: "knowledge",
        targetId: "00000000-0000-4000-8000-000000000011",
        summary: "归档知识资料「退款规则.md」",
        actorName: "演示用户",
        data: {},
        createdAt: "2026-09-25T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        action: "memory.restored",
        targetType: "memory",
        targetId: "00000000-0000-4000-8000-000000000012",
        summary: "恢复助手经验",
        actorName: "演示用户",
        data: {},
        createdAt: "2026-09-25T00:01:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        action: "evaluation.started",
        targetType: "evaluation",
        targetId: "00000000-0000-4000-8000-000000000013",
        summary: "启动自动验收",
        actorName: "演示用户",
        data: { caseCount: 3 },
        createdAt: "2026-09-25T00:02:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        action: "run.feedback_regression_created",
        targetType: "run",
        targetId: "00000000-0000-4000-8000-000000000014",
        summary: "把运行反馈加入验收样例",
        actorName: "演示用户",
        data: {},
        createdAt: "2026-09-25T00:03:00.000Z",
      },
    ]} />);

    expect(screen.getByText("归档资料")).toBeVisible();
    expect(screen.getByText("恢复经验")).toBeVisible();
    expect(screen.getAllByText("启动自动验收")).toHaveLength(2);
    expect(screen.getByText("反馈加入验收")).toBeVisible();
    expect(screen.getAllByText(/演示用户 · 2026.*08:00:00/).length).toBeGreaterThan(0);
    expect(within(screen.getByText("归档知识资料「退款规则.md」").closest("li")!).getByRole("link", { name: "前往资料列表" })).toHaveAttribute("href", "/knowledge");
    expect(within(screen.getByText("恢复助手经验").closest("li")!).getByRole("link", { name: "前往成长中心" })).toHaveAttribute("href", "/memory");
    expect(within(screen.getAllByText("启动自动验收")[0].closest("li")!).getByRole("link", { name: "前往验收中心" })).toHaveAttribute("href", "/acceptance");
    expect(within(screen.getByText("把运行反馈加入验收样例").closest("li")!).getByRole("link", { name: "查看相关运行反馈" })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000014#feedback");
  });

  it("只为有详情路由的对象生成深链，停用助手则返回列表", () => {
    render(<AuditEventList events={[
      { id: "00000000-0000-4000-8000-000000000021", action: "agent.created", targetType: "agent", targetId: "00000000-0000-4000-8000-000000000031", summary: "创建助手甲", actorName: "演示用户", data: {}, createdAt: "2026-09-25T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000022", action: "agent.archived", targetType: "agent", targetId: "00000000-0000-4000-8000-000000000032", summary: "停用助手乙", actorName: "演示用户", data: {}, createdAt: "2026-09-25T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000023", action: "workflow.saved", targetType: "workflow", targetId: "00000000-0000-4000-8000-000000000033", summary: "保存流程丙", actorName: "演示用户", data: {}, createdAt: "2026-09-25T00:00:00.000Z" },
      { id: "00000000-0000-4000-8000-000000000024", action: "version.published", targetType: "version", targetId: "00000000-0000-4000-8000-000000000034", summary: "发布版本丁", actorName: "演示用户", data: {}, createdAt: "2026-09-25T00:00:00.000Z" },
    ]} />);
    expect(within(screen.getByText("创建助手甲").closest("li")!).getByRole("link", { name: "打开相关助手" })).toHaveAttribute("href", "/agents/00000000-0000-4000-8000-000000000031");
    expect(within(screen.getByText("停用助手乙").closest("li")!).getByRole("link", { name: "前往助手列表" })).toHaveAttribute("href", "/agents");
    expect(within(screen.getByText("保存流程丙").closest("li")!).getByRole("link", { name: "前往助手列表" })).toHaveAttribute("href", "/agents");
    expect(within(screen.getByText("发布版本丁").closest("li")!).getByRole("link", { name: "前往发布中心" })).toHaveAttribute("href", "/releases");
  });
});
