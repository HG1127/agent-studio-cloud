import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeSourceView } from "@/contracts/knowledge";
import { KnowledgeSourceDetails } from "@/features/knowledge/KnowledgeSourceDetails";

const source = KnowledgeSourceView.parse({ id: "00000000-0000-4000-8000-000000000091", name: "公司售后处理手册.txt", mime: "text/plain", sizeBytes: 2048, status: "indexed", chunkCount: 3, charCount: 1234, error: null, hasOriginal: true, createdAt: "2026-10-08T00:01:02.000Z" });
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
afterEach(() => vi.unstubAllGlobals());

describe("真实资料记录详情", () => {
  it("只按记录显示中文统计与北京时间，不把它称为全文或助手使用证明", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<KnowledgeSourceDetails source={source} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    const dialog = screen.getByRole("dialog", { name: "资料记录详情" });
    expect(within(dialog).getByText(source.name)).toBeInTheDocument();
    for (const text of ["纯文本", "2.0 千字节", "3 段", "1,234 个字符", "已记录原文件", "2026/10/08 08:01:02"]) expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(dialog).toHaveTextContent("不是全文预览");
    expect(dialog).toHaveTextContent("不代表所有助手都可引用");
    expect(dialog).not.toHaveTextContent(source.id);
    expect(dialog).not.toHaveTextContent(source.mime);
    expect(within(dialog).getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", `/api/knowledge/sources/${source.id}/file`);
    expect(within(dialog).getByRole("link", { name: "核对助手资料范围" })).toHaveAttribute("href", "/agents");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, undefined])("原文件保留值为 %s 时没有猜测的下载入口", async (hasOriginal) => {
    render(<KnowledgeSourceDetails source={{ ...source, hasOriginal }} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(hasOriginal === false ? "未保留原文件" : "暂未核对")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "下载原文件" })).not.toBeInTheDocument();
  });

  it("解析中真实零统计不冒充缺失或已经就绪", async () => {
    render(<KnowledgeSourceDetails source={{ ...source, status: "parsing", chunkCount: 0, charCount: 0 }} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("0 段")).toBeInTheDocument();
    expect(within(dialog).getByText("0 个字符")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("当前段数与字符数可能继续变化");
    expect(dialog).not.toHaveTextContent("这份资料已就绪");
  });

  it.each([true, false, undefined])("解析中断时按原文件真实保留状态 %s 说明恢复方式", async (hasOriginal) => {
    render(<KnowledgeSourceDetails source={{ ...source, status: "parsing", parsingStalled: true, hasOriginal, error: "解析任务已中断" }} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("解析已中断");
    expect(dialog).toHaveTextContent(hasOriginal === true ? "在列表中重新解析" : hasOriginal === false ? "需要重新上传同一文件" : "原文件是否保留尚未核对");
    expect(dialog).toHaveTextContent("已保存的解析说明");
    expect(within(dialog).queryByRole("button", { name: "重新解析" })).not.toBeInTheDocument();
  });

  it("当前记录重新读取后更新详情，不保留另一份旧统计或解析错误", async () => {
    const { rerender } = render(<KnowledgeSourceDetails source={{ ...source, status: "failed", error: "上次解析失败" }} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    rerender(<KnowledgeSourceDetails source={{ ...source, charCount: 9999 }} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("9,999 个字符");
    expect(dialog).not.toHaveTextContent("上次解析失败");
    expect(within(dialog).getByText("已就绪")).toBeInTheDocument();
  });

  it("详情内重新读取只核对当前路由，不提交或自动轮询", async () => {
    refresh.mockClear();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<KnowledgeSourceDetails source={source} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重新读取状态" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("归档详情不声称当前可检索，仍保留真实原文件下载路径", async () => {
    render(<KnowledgeSourceDetails source={{ ...source, status: "archived" }} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("已归档资料不参与助手后续检索");
    expect(within(dialog).getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", `/api/knowledge/sources/${source.id}/file`);
  });

  it("无效时间、负统计或未知类型不伪造零和原始内部格式", async () => {
    render(<KnowledgeSourceDetails source={{ ...source, mime: "private/unknown", createdAt: "not-a-date", sizeBytes: -1, charCount: -1, chunkCount: -1 }} />);
    await userEvent.click(screen.getByRole("button", { name: "查看资料" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("未识别类型")).toBeInTheDocument();
    expect(within(dialog).getByText("时间暂不可读")).toBeInTheDocument();
    expect(within(dialog).getAllByText("暂未核对")).toHaveLength(3);
    expect(dialog).not.toHaveTextContent("private/unknown");
    expect(dialog).not.toHaveTextContent("-1");
  });

  it("弹窗保持键盘焦点，关闭后返回发起按钮", async () => {
    const user = userEvent.setup();
    render(<KnowledgeSourceDetails source={source} />);
    const trigger = screen.getByRole("button", { name: "查看资料" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    for (let index = 0; index < 6; index++) { await user.tab(); expect(dialog.contains(document.activeElement)).toBe(true); }
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(trigger).toHaveFocus();
  });
});
