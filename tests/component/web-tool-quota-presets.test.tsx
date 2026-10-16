import { createRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebToolDesignStudio } from "@/features/web-tools/WebToolDesignStudio";
import { WebToolQuotaPresetPicker } from "@/features/web-tools/WebToolQuotaPresetPicker";
import { createWebToolDesignDraft } from "@/features/web-tools/web-tool-design-draft";
import { WEB_TOOL_QUOTA_FIELDS, WEB_TOOL_QUOTA_PRESETS } from "@/features/web-tools/web-tool-design-quota";

const network = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", network); });
afterEach(() => { cleanup(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function picker(draft = createWebToolDesignDraft()) {
  const onApply = vi.fn();
  const manualInputRef = createRef<HTMLInputElement>();
  const view = render(<><WebToolQuotaPresetPicker draft={draft} onApply={onApply} manualInputRef={manualInputRef} />
    <input ref={manualInputRef} aria-label="手动用量" defaultValue="保留现值" /></>);
  return { onApply, manualInputRef, view };
}

function quotaValues() {
  return WEB_TOOL_QUOTA_FIELDS.map(({ label }) => Number((screen.getByRole("spinbutton", { name: label }) as HTMLInputElement).value));
}

async function openAccess(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "团队网页工具");
  await user.click(screen.getByRole("button", { name: "4. 访问与发布" }));
}

describe("网页工具用量方案的真实编辑入口", () => {
  it("初始方案展示完整五项，重复选择不改草稿，自定义只聚焦而不清空", async () => {
    const user = userEvent.setup();
    const { onApply } = picker();
    const normal = screen.getByRole("button", { name: /^常规使用/ });
    expect(normal).toHaveAttribute("aria-pressed", "true");
    expect(normal).toHaveTextContent("每小时 20 次 · 每天 100 次");
    expect(normal).toHaveTextContent("并发 3 · 最长 180 秒 · 成本额度 50");
    expect(screen.getByRole("button", { name: /^团队协同/ })).toHaveTextContent("并发 5 · 最长 300 秒 · 成本额度 80");
    await user.click(normal);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^逐项自定义/ }));
    expect(screen.getByRole("textbox", { name: "手动用量" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "手动用量" })).toHaveValue("保留现值");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("替换前逐项核对差异，取消保留原值并返回触发按钮", async () => {
    const user = userEvent.setup();
    const { onApply } = picker();
    const team = screen.getByRole("button", { name: /^团队协同/ });
    await user.click(team);
    const dialog = screen.getByRole("dialog", { name: "确认替换用量方案？" });
    for (const text of ["每小时次数上限：20 → 60", "每天次数上限：100 → 300", "最大并发数：3 → 5", "最长运行时间（秒）：180 → 300", "成本额度上限：50 → 80"]) expect(dialog).toHaveTextContent(text);
    expect(dialog).toHaveTextContent("尚未保存或执行");
    expect(onApply).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    await waitFor(() => expect(team).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^常规使用/ })).toHaveAttribute("aria-pressed", "true");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("键盘可打开确认，明确确认只回传一次所选方案", async () => {
    const user = userEvent.setup();
    const { onApply } = picker();
    screen.getByRole("button", { name: /^团队协同/ }).focus();
    await user.keyboard("{Enter}");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "替换五项用量" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith("standard");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("关闭确认不修改数值，无效旧值明确展示而不伪装为默认值", async () => {
    const user = userEvent.setup();
    const { onApply } = picker({ ...createWebToolDesignDraft(), maxPerHour: NaN });
    expect(screen.getByText("按当前五项数值识别：自定义")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("每小时次数上限：未填写或无效 → 60");
    await user.keyboard("{Escape}");
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("当前方案和待确认差异跟随最新草稿，不缓存过期标签或数值", async () => {
    const user = userEvent.setup();
    const draft = createWebToolDesignDraft();
    const onApply = vi.fn();
    const manualInputRef = createRef<HTMLInputElement>();
    const view = render(<WebToolQuotaPresetPicker draft={draft} onApply={onApply} manualInputRef={manualInputRef} />);
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    view.rerender(<WebToolQuotaPresetPicker draft={{ ...draft, maxPerHour: 7 }} onApply={onApply} manualInputRef={manualInputRef} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("每小时次数上限：7 → 60");
    await user.keyboard("{Escape}");
    expect(screen.getByText("按当前五项数值识别：自定义")).toBeVisible();
    view.rerender(<WebToolQuotaPresetPicker draft={{ ...draft, ...WEB_TOOL_QUOTA_PRESETS[1].values }} onApply={onApply} manualInputRef={manualInputRef} />);
    expect(screen.getByRole("button", { name: /^团队协同/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^常规使用/ })).toHaveAttribute("aria-pressed", "false");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("实际第四步确认替换五项，手动调整立即显示自定义，切换步骤后仍保留", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await openAccess(user);
    expect(quotaValues()).toEqual([20, 100, 3, 180, 50]);
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "替换五项用量" }));
    expect(quotaValues()).toEqual([60, 300, 5, 300, 80]);
    expect(screen.getByRole("status")).toHaveTextContent("五项用量已替换到本页草稿，尚未保存或执行");
    fireEvent.change(screen.getByRole("spinbutton", { name: "成本额度上限" }), { target: { value: "17.5" } });
    expect(screen.getByText("按当前五项数值识别：自定义")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "1. 基本信息" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("团队网页工具");
    await user.click(screen.getByRole("button", { name: "4. 访问与发布" }));
    expect(quotaValues()).toEqual([60, 300, 5, 300, 17.5]);
    await user.click(screen.getByRole("button", { name: /^逐项自定义/ }));
    expect(screen.getByRole("spinbutton", { name: "每小时次数上限" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "保存页面配置（待接入）" })).toBeDisabled();
  });

  it("实际无效数值在取消后保留，确认替换后才恢复并清除对应错误", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await openAccess(user);
    const hour = screen.getByRole("spinbutton", { name: "每小时次数上限" });
    fireEvent.change(hour, { target: { value: "" } });
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(hour).toHaveValue(null);
    expect(hour).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("每小时次数上限：未填写或无效 → 60");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(hour).toHaveValue(null);
    expect(hour).toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "替换五项用量" }));
    expect(hour).toHaveValue(60);
    expect(hour).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(quotaValues()).toEqual([60, 300, 5, 300, 80]);
  });

  it("独立设计之间不串改数值或手动编辑焦点", async () => {
    const user = userEvent.setup();
    render(<><section aria-label="第一份设计"><WebToolDesignStudio targets={[]} /></section>
      <section aria-label="第二份设计"><WebToolDesignStudio targets={[]} /></section></>);
    const first = within(screen.getByRole("region", { name: "第一份设计" }));
    const second = within(screen.getByRole("region", { name: "第二份设计" }));
    fireEvent.change(first.getByRole("textbox", { name: "工具展示名称" }), { target: { value: "第一份" } });
    fireEvent.change(second.getByRole("textbox", { name: "工具展示名称" }), { target: { value: "第二份" } });
    await user.click(first.getByRole("button", { name: "4. 访问与发布" }));
    await user.click(second.getByRole("button", { name: "4. 访问与发布" }));
    fireEvent.change(second.getByRole("spinbutton", { name: "最大并发数" }), { target: { value: "7" } });
    await user.click(first.getByRole("button", { name: /^团队协同/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "替换五项用量" }));
    expect(first.getByRole("spinbutton", { name: "最大并发数" })).toHaveValue(5);
    expect(second.getByRole("spinbutton", { name: "最大并发数" })).toHaveValue(7);
    expect(second.getByRole("spinbutton", { name: "每小时次数上限" })).toHaveValue(20);
    await user.click(second.getByRole("button", { name: /^逐项自定义/ }));
    expect(second.getByRole("spinbutton", { name: "每小时次数上限" })).toHaveFocus();
    expect(first.getByRole("spinbutton", { name: "每小时次数上限" })).not.toHaveFocus();
  });

  it("专业配置往返保留其他设计与预览填写，取消不覆盖，清空恢复初始用量", async () => {
    const user = userEvent.setup();
    const draft = { ...createWebToolDesignDraft(), name: "保留的设计", description: "不替换的说明", domains: "https://team.example.test",
      fields: [{ id: "business", name: "business_text", label: "业务正文", type: "string" as const, required: true, rows: 3, placeholder: "", description: "" }],
      modules: [{ id: "result", title: "业务结果", source: "result", component: "ResultCard" as const, enabled: true, description: "" }],
      maxPerHour: 7, maxPerDay: 70, maxConcurrent: 2, maxRuntimeSeconds: 120, maxCostUnits: 15 };
    render(<WebToolDesignStudio targets={[]} />);
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    fireEvent.change(screen.getByRole("textbox", { name: "本页设计结构" }), { target: { value: JSON.stringify(draft) } });
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.type(screen.getByRole("textbox", { name: "业务正文（必填）" }), "不丢失的预览填写");
    await user.click(screen.getByRole("button", { name: "4. 访问与发布" }));
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(quotaValues()).toEqual([7, 70, 2, 120, 15]);
    await user.click(screen.getByRole("button", { name: /^团队协同/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "替换五项用量" }));
    expect(screen.getByRole("textbox", { name: "业务正文（必填）" })).toHaveValue("不丢失的预览填写");
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const editor = screen.getByRole("textbox", { name: "本页设计结构" }) as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual({ ...draft, ...WEB_TOOL_QUOTA_PRESETS[1].values });
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空本页草稿" }));
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(false);
    await openAccess(user);
    expect(quotaValues()).toEqual([20, 100, 3, 180, 50]);
    expect(screen.getByRole("button", { name: /^常规使用/ })).toHaveAttribute("aria-pressed", "true");
  });
});
