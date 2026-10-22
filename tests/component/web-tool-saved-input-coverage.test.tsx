import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentInputContract } from "@/contracts/manifest";
import { MAX_RUN_INPUT_BYTES, type RunView } from "@/contracts/run";
import { WebToolSavedInputCoverage } from "@/features/web-tools/WebToolSavedInputCoverage";

function record(input: Record<string, unknown>, fields: unknown[] = [
  { name: "brief_private", label: "任务说明", type: "string", required: true },
]): Pick<RunView, "input" | "inputContract"> {
  return { input, inputContract: AgentInputContract.parse({ fields }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("保存输入覆盖核对", () => {
  it("同时保留约定项和额外保存项，不因匹配到约定字段而丢弃其他记录", () => {
    render(<WebToolSavedInputCoverage run={record({ brief_private: "真实保存任务", extra_private: "额外保存内容" })} />);
    expect(screen.getByLabelText("本次输入约定覆盖情况")).toHaveTextContent("真实保存任务");
    expect(screen.getByLabelText("约定外的保存输入")).toHaveTextContent("额外保存内容");
    expect(screen.getByText(/还包含 1 项未在返回的输入约定中声明/)).toBeVisible();
    expect(screen.getByText(/不能据此判断当时提交是否合法/)).toBeVisible();
    expect(screen.getByLabelText("本次输入约定覆盖情况")).not.toHaveTextContent("brief_private");
    expect(screen.getByLabelText("约定外的保存输入")).not.toHaveTextContent("extra_private");
    expect(screen.getByText("查看完整保存输入（开发者数据）").closest("details")).toHaveTextContent("extra_private");
  });

  it("数字零与否值保留原类型并使用实际运行基础校验", () => {
    render(<WebToolSavedInputCoverage run={record({ count: 0, confirmed: false }, [
      { name: "count", label: "数量", type: "number", required: true },
      { name: "confirmed", label: "是否确认", type: "boolean", required: true },
    ])} />);
    const rows = within(screen.getByLabelText("本次输入约定覆盖情况")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("数量");
    expect(rows[0]).toHaveTextContent("0");
    expect(rows[1]).toHaveTextContent("否");
    expect(screen.getAllByText("已记录，基础格式相符")).toHaveLength(2);
    expect(screen.queryByText(/已记录空内容/)).not.toBeInTheDocument();
  });

  it("完整保留契约顺序，缺失必填与未记录选填有明确区别，不填入默认值", () => {
    render(<WebToolSavedInputCoverage run={record({}, [
      { name: "must_private", label: "必填说明", type: "string", required: true },
      { name: "optional_private", label: "可选说明", type: "object", required: false },
    ])} />);
    expect(screen.getByText("必填项未记录")).toBeVisible();
    expect(screen.getByText("选填项未记录")).toBeVisible();
    expect(screen.getByText(/本次保存输入为空/)).toBeVisible();
    const rows = within(screen.getByLabelText("本次输入约定覆盖情况")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("必填说明");
    expect(rows[1]).toHaveTextContent("可选说明");
    expect(rows[0]).not.toHaveTextContent("暂无内容");
  });

  it.each([null, "", " \n "])("已保存的空必填区别于没有记录：%s", (value) => {
    render(<WebToolSavedInputCoverage run={record({ brief_private: value })} />);
    expect(screen.getByText("必填项已记录空内容")).toBeVisible();
    expect(screen.queryByText("必填项未记录")).not.toBeInTheDocument();
  });

  it("已保存空选填不声称原记录被省略", () => {
    render(<WebToolSavedInputCoverage run={record({ optional_private: null }, [
      { name: "optional_private", label: "可选说明", type: "object", required: false },
    ])} />);
    expect(screen.getByText("选填项已记录空内容")).toBeVisible();
    expect(screen.queryByText("选填项未记录")).not.toBeInTheDocument();
  });

  it("基础格式不符时保留原值，不自动转成约定类型或声称通过", () => {
    render(<WebToolSavedInputCoverage run={record({ count_private: "0", list_private: { 真实内容: "保留对象" } }, [
      { name: "count_private", label: "数量", type: "number", required: true },
      { name: "list_private", label: "清单", type: "array", required: true },
    ])} />);
    expect(screen.getAllByText("已记录，基础格式不符")).toHaveLength(2);
    expect(screen.getByLabelText("本次输入约定覆盖情况")).toHaveTextContent("保留对象");
    expect(screen.queryByText("已记录，基础格式相符")).not.toBeInTheDocument();
    expect(screen.getByText("查看完整保存输入（开发者数据）").closest("details")).toHaveTextContent('"count_private": "0"');
  });

  it("对象与列表用实际保存值核对，不要求或编造不存在的深层约定", () => {
    render(<WebToolSavedInputCoverage run={record({ object_private: { 清单: [0, false] }, array_private: ["原条目"] }, [
      { name: "object_private", label: "结构内容", type: "object", required: true },
      { name: "array_private", label: "清单内容", type: "array", required: true },
    ])} />);
    expect(screen.getAllByText("已记录，基础格式相符")).toHaveLength(2);
    expect(screen.getByLabelText("本次输入约定覆盖情况")).toHaveTextContent("原条目");
    expect(screen.getByLabelText("本次输入约定覆盖情况")).toHaveTextContent("否");
  });

  it("空输入约定保持未知，不把全部保存项说成未声明或没有约定", () => {
    render(<WebToolSavedInputCoverage run={record({ hidden_private: "保留原输入" }, [])} />);
    expect(screen.getByText(/无法判断哪些输入已声明/)).toBeVisible();
    expect(screen.getByText(/这不证明当时没有约定/)).toBeVisible();
    expect(screen.getByLabelText("按保存记录逐项核对")).toHaveTextContent("保留原输入");
    expect(screen.queryByText(/未在返回的输入约定中声明/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("本次输入约定覆盖情况")).not.toBeInTheDocument();
  });

  it("异常重复字段约定降级未知并完整保留实际输入，不展示校验器原始错误", () => {
    const run = record({ brief_private: "真实内容", extra_private: "补充内容" });
    const corrupted = { ...run, inputContract: { fields: [run.inputContract.fields[0], run.inputContract.fields[0]] } };
    render(<WebToolSavedInputCoverage run={corrupted} />);
    expect(screen.getByText(/输入约定暂时无法核对/)).toBeVisible();
    expect(screen.getByLabelText("按保存记录逐项核对")).toHaveTextContent("真实内容");
    expect(screen.getByLabelText("按保存记录逐项核对")).toHaveTextContent("补充内容");
    expect(screen.queryByText("运行输入字段名不能重复")).not.toBeInTheDocument();
  });

  it("在声明与补充内容及开发者数据中均隐藏凭据和敏感资料", () => {
    render(<WebToolSavedInputCoverage run={record({
      brief_private: "业务正文 api_key=secret-value-for-test",
      extra_private: { token: "private-token-value", 邮箱: "somebody@example.com", 正文: "需要保留的业务说明" },
    })} />);
    const section = screen.getByLabelText("保存输入覆盖核对");
    expect(section).not.toHaveTextContent("secret-value-for-test");
    expect(section).not.toHaveTextContent("private-token-value");
    expect(section).not.toHaveTextContent("somebody@example.com");
    expect(section).toHaveTextContent("[已隐藏敏感信息]");
    expect(section).toHaveTextContent("需要保留的业务说明");
    expect(screen.getByText("查看完整保存输入（开发者数据）").closest("details")).not.toHaveAttribute("open");
  });

  it("不执行访问器，未知保存数据只显示固定提示", () => {
    const getter = vi.fn(() => "private-accessor-value");
    const input = Object.defineProperty({}, "brief_private", { enumerable: true, get: getter });
    render(<WebToolSavedInputCoverage run={record(input)} />);
    expect(getter).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("核对状态未知");
    expect(screen.queryByText("查看完整保存输入（开发者数据）")).not.toBeInTheDocument();
    expect(screen.getByLabelText("保存输入覆盖核对")).not.toHaveTextContent("private-accessor-value");
  });

  it("超出真实保存输入容量时不截断或展示未经核对的片段", () => {
    render(<WebToolSavedInputCoverage run={record({ brief_private: "文".repeat(Math.ceil(MAX_RUN_INPUT_BYTES / 3)) })} />);
    expect(screen.getByRole("status")).toHaveTextContent("安全展示");
    expect(screen.getByRole("status")).toHaveTextContent("没有删改记录");
    expect(screen.queryByLabelText("本次输入约定覆盖情况")).not.toBeInTheDocument();
  });

  it("保留原记录，不进行网络、浏览器存储、写入、复制或启动操作", () => {
    const run = record({ brief_private: "原输入", extra_private: { 数量: 0, 标记: false } });
    const before = JSON.stringify(run);
    Object.freeze(run.input.extra_private); Object.freeze(run.input); Object.freeze(run);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const stored = vi.spyOn(Storage.prototype, "setItem");
    const copy = vi.fn(); vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    render(<WebToolSavedInputCoverage run={run} />);
    expect(JSON.stringify(run)).toBe(before);
    expect(fetcher).not.toHaveBeenCalled();
    expect(stored).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/不证明输入来自哪个页面/)).toBeVisible();
  });
});
