import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentInputField } from "@/contracts/manifest";
import { MAX_RUN_INPUT_BYTES, RunInputPayload, type StartRunResult } from "@/contracts/run";
import type { RunTaskStartInput } from "@/contracts/run-task";
import { RunLauncher } from "@/features/agents/RunLauncher";
import { prepareRunLauncherInput } from "@/features/agents/run-launcher-input";

const { start, push } = vi.hoisted(() => ({
  start: vi.fn<(input: RunTaskStartInput) => Promise<StartRunResult>>(), push: vi.fn(),
}));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const agentId = "00000000-0000-4000-8000-000000000911";
const versionId = "00000000-0000-4000-8000-000000000912";
const requestId = "00000000-0000-4000-8000-000000000913";
const fields: AgentInputField[] = [
  { name: "brief", label: "业务材料", type: "string", required: true },
  { name: "count", label: "数量", type: "number", required: true },
  { name: "confirmed", label: "是否确认", type: "boolean", required: true },
  { name: "details", label: "详细内容", type: "object", required: true },
  { name: "items", label: "交付条目", type: "array", required: true },
  { name: "optional", label: "补充说明", type: "string", required: false },
];
const raw = { brief: "  第一行\n第二行  " + "业务材料".repeat(1500), count: "0", confirmed: "false", details: '{"label":"业务详情","next":"保留的业务字段"}', items: '[0,false,{"说明":"条目"}]' };
const preparedInput = { brief: raw.brief, count: 0, confirmed: false, details: { label: "业务详情", next: "保留的业务字段" }, items: [0, false, { 说明: "条目" }] };
beforeEach(() => { start.mockReset(); push.mockReset(); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId); });
afterEach(() => vi.restoreAllMocks());

describe("RunLauncher 只投影真实共享输入契约", () => {
  it("纯投影保留超过四千字符的多行原文、零、否、对象与数组，不补选填说明", () => {
    expect(raw.brief.length).toBeGreaterThan(4000);
    expect(prepareRunLauncherInput(fields, raw, "{}")).toEqual({ input: preparedInput, error: null });
  });

  it("通用对象输入保留业务布尔、数组、嵌套业务字段与空值", () => {
    const value = { content: "  原文\n第二行  ", count: 0, flag: false, details: { next: "业务下一步", matched: false }, items: [0, false], extra: null };
    expect(prepareRunLauncherInput(undefined, {}, JSON.stringify(value))).toEqual({ input: value, error: null });
    expect(prepareRunLauncherInput([], {}, "{}")).toEqual({ input: {}, error: null });
  });

  it.each([
    { field: "count", value: "12x", error: "数量必须是数字" },
    { field: "count", value: "Infinity", error: "数量必须是数字" },
    { field: "confirmed", value: "否", error: "请为是否确认选择是或否" },
    { field: "details", value: "[]", error: "详细内容的格式不正确" },
    { field: "details", value: "null", error: "详细内容的格式不正确" },
    { field: "items", value: "{}", error: "交付条目的格式不正确" },
    { field: "items", value: "[bad", error: "交付条目的格式不正确" },
    { field: "brief", value: "  \n ", error: "请填写业务材料" },
  ])("拒绝 $field 的 $value，不把不合法布尔静默变为否", ({ field, value, error }) => {
    const result = prepareRunLauncherInput(fields, { ...raw, [field]: value }, "{}");
    expect(result.input).toBeNull();
    expect(result.error).toBe(error);
  });

  it.each(["[1,2]", "null", '"正文"', "{bad"])("通用入口拒绝非对象或非法文本 %s", (text) => {
    expect(prepareRunLauncherInput(undefined, {}, text)).toEqual({ input: null, error: "请输入正确的 JSON 格式" });
  });

  it("按整份序列化输入 UTF-8 字节判断恰好 100KiB 与超出一字节，不另造单字段上限", () => {
    const overhead = new TextEncoder().encode(JSON.stringify({ brief: "" })).byteLength;
    const room = MAX_RUN_INPUT_BYTES - overhead;
    const exact = "界".repeat(Math.floor(room / 3)) + "x".repeat(room % 3);
    const field: AgentInputField[] = [{ name: "brief", label: "业务材料", type: "string", required: true }];
    expect(new TextEncoder().encode(JSON.stringify({ brief: exact })).byteLength).toBe(MAX_RUN_INPUT_BYTES);
    expect(prepareRunLauncherInput(field, { brief: exact }, "{}")).toEqual({ input: { brief: exact }, error: null });
    const rejected = prepareRunLauncherInput(field, { brief: exact + "x" }, "{}");
    expect(rejected.input).toBeNull(); expect(rejected.error).toBe("运行输入不能超过 100 KB");
    expect(prepareRunLauncherInput(undefined, {}, JSON.stringify({ brief: exact + "x" })).input).toBeNull();
  });

  it("多字段各自未超限但合计超过 100KiB 仍拒绝", () => {
    const contract: AgentInputField[] = [
      { name: "brief", label: "业务材料", type: "string", required: true },
      { name: "extra", label: "补充材料", type: "string", required: true },
    ];
    expect(prepareRunLauncherInput(contract, { brief: "甲".repeat(18000), extra: "乙".repeat(18000) }, "{}")).toEqual({ input: null, error: "运行输入不能超过 100 KB" });
  });

  it("共享契约的深度、数据项、保留字段与字段长度边界均用于最终对象", () => {
    let nested: unknown = { leaf: "正文" };
    for (let depth = 0; depth < 12; depth += 1) nested = { child: nested };
    const invalid = [
      { value: { payload: nested }, message: "最多嵌套 12 层" },
      { value: { items: Array.from({ length: 2001 }, () => 0) }, message: "最多包含 2000 个数据项" },
      { value: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${index}`, 0])), message: "最多包含 100 个字段" },
      { value: JSON.parse('{"data":{"constructor":"不得保存"}}') as unknown, message: "不能使用保留字段名" },
      { value: { ["x".repeat(101)]: "正文" }, message: "字段名不能超过 100 个字符" },
    ];
    for (const item of invalid) {
      const result = prepareRunLauncherInput(undefined, {}, JSON.stringify(item.value));
      expect(result.input).toBeNull(); expect(result.error).toContain(item.message);
      expect(RunInputPayload.safeParse(item.value).success).toBe(false);
    }
    const reserved: AgentInputField[] = [{ name: "__proto__", label: "业务材料", type: "string", required: true }];
    expect(prepareRunLauncherInput(reserved, JSON.parse('{"__proto__":"原文"}') as Record<string, string>, "{}").error).toContain("不能使用保留字段名");
    expect(prepareRunLauncherInput([{ name: "details", label: "详细内容", type: "object", required: true }], { details: '{"prototype":false}' }, "{}").input).toBeNull();
  });
});

describe("真实 RunLauncher 控件与动作的容量边界", () => {
  it("多行正文不截断，零、否、对象与数组经真实父表单传给任务动作", async () => {
    start.mockResolvedValueOnce({ ok: false, error: "服务端真实拒绝" });
    render(<RunLauncher agentId={agentId} productionVersionId={versionId} inputFields={fields} />);
    for (const field of fields) {
      const label = `${field.label}（${field.required ? "必填" : "选填"}）`;
      const control = screen.getByLabelText(label);
      expect(control).not.toHaveAttribute("maxlength");
      if (field.name === "optional") expect(control).toHaveValue("");
      else fireEvent.change(control, { target: { value: raw[field.name as keyof typeof raw] } });
      if (field.type === "string") expect(control.tagName).toBe("TEXTAREA");
    }
    const brief = screen.getByLabelText("业务材料（必填）");
    expect(brief).toHaveValue(raw.brief);
    fireEvent.submit(brief.closest("form")!);
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith({ agentId, versionId, requestId, input: preparedInput }));
    expect(await screen.findByRole("alert")).toHaveTextContent("服务端真实拒绝");
    expect(brief).toBeEnabled(); expect(brief).toHaveValue(raw.brief); expect(push).not.toHaveBeenCalled();
  });

  it.each(["declared", "generic"] as const)("%s 的超限输入未发送、原文可改且修正后仅人工提交", async (mode) => {
    const declared: AgentInputField[] = [{ name: "brief", label: "业务材料", type: "string", required: true }];
    render(<RunLauncher agentId={agentId} productionVersionId={versionId} inputFields={mode === "declared" ? declared : []} />);
    const control = screen.getByLabelText(mode === "declared" ? "业务材料（必填）" : "运行输入（对象格式）");
    const over = "界".repeat(35000);
    const text = mode === "declared" ? over : JSON.stringify({ brief: over });
    fireEvent.change(control, { target: { value: text } }); fireEvent.submit(control.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("运行输入不能超过 100 KB");
    expect(control).toHaveValue(text); expect(control).toBeEnabled(); expect(start).not.toHaveBeenCalled();
    expect(crypto.randomUUID).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "核对上次启动" })).not.toBeInTheDocument();
    fireEvent.change(control, { target: { value: mode === "declared" ? "修正\n原文" : '{"brief":"修正\\n原文"}' } });
    expect(start).not.toHaveBeenCalled();
    start.mockResolvedValueOnce({ ok: false, error: "修正后真实拒绝" });
    fireEvent.submit(control.closest("form")!);
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith({ agentId, versionId, requestId, input: { brief: "修正\n原文" } }));
  });

  it("数字控件保留长原文，不因控件截断或非法文本变空导致丢失填写", async () => {
    render(<RunLauncher agentId={agentId} productionVersionId={versionId} inputFields={[{ name: "count", label: "数量", type: "number", required: true }]} />);
    const control = screen.getByLabelText("数量（必填）");
    expect(control).toHaveAttribute("type", "text"); expect(control).toHaveAttribute("inputmode", "decimal");
    fireEvent.change(control, { target: { value: "0".repeat(5000) } }); expect(control).toHaveValue("0".repeat(5000));
    start.mockResolvedValueOnce({ ok: false, error: "服务器拒绝" });
    fireEvent.submit(control.closest("form")!);
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith({ agentId, versionId, requestId, input: { count: 0 } }));
    fireEvent.change(control, { target: { value: "123not-number" } }); fireEvent.submit(control.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("数量必须是数字");
    expect(control).toHaveValue("123not-number"); expect(control).toBeEnabled(); expect(start).toHaveBeenCalledOnce();
  });
});
