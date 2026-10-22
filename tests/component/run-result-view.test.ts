import { describe, expect, it } from "vitest";
import { RunView } from "@/contracts/run";
import { readSavedResultPath, savedRunResultView } from "@/features/runs/run-result-view";

const outputContract = RunView.shape.outputContract.parse({ fields: [
  { path: "delivery.total", label: "费用", required: true },
  { path: "delivery.accepted", label: "是否通过", required: true },
  { path: "delivery.note", label: "补充说明", required: false },
] });
describe("实际运行契约的结果展示", () => {
  it("按保存的契约选择嵌套值，零、否、空文字不丢失，缺失不补造", () => {
    const result = { delivery: { total: 0, accepted: false, note: "" }, unlisted: "不套用其他版本" };
    const view = savedRunResultView({ result, outputContract });
    expect(view.outputs.map((field) => field.output)).toEqual([0, false, ""]);
    expect(view.copyText).toBe("费用\n0\n\n是否通过\nfalse\n\n补充说明\n");
    expect(result).toEqual({ delivery: { total: 0, accepted: false, note: "" }, unlisted: "不套用其他版本" });
  });
  it("只读取自身属性，不遍历原型和列表路径", () => {
    expect(readSavedResultPath({}, "constructor.name")).toBeUndefined();
    expect(readSavedResultPath({ delivery: [{ value: 1 }] }, "delivery.0.value")).toBeUndefined();
    expect(readSavedResultPath({ delivery: { value: null } }, "delivery.value")).toBeNull();
  });
  it("没有命中契约时保留实际保存内容，使用中文标签而非内部步骤编号", () => {
    const view = savedRunResultView({ result: { internalStep: "依据", 第二步: "结论" }, outputContract });
    expect(view.outputs).toEqual([{ key: "internalStep", label: "步骤结果 1", output: "依据" }, { key: "第二步", label: "第二步", output: "结论" }]);
    expect(view.copyText).toBeUndefined();
    expect(savedRunResultView({ result: { internalStep: "依据" }, outputContract }, new Map([["internalStep", "整理资料"]])).outputs[0].label).toBe("整理资料");
  });
  it("展示及复制使用同一脱敏值，不泄漏凭据或个人信息", () => {
    const contract = RunView.shape.outputContract.parse({ fields: [{ path: "delivery.note", label: "业务摘要", required: true }] });
    const view = savedRunResultView({ result: { delivery: { note: "联系 buyer@example.test，凭据 sk-privatecredential123456" }, password: "never-show-this" }, outputContract: contract });
    expect(JSON.stringify(view)).not.toContain("buyer@example.test");
    expect(JSON.stringify(view)).not.toContain("sk-privatecredential123456");
    expect(JSON.stringify(view)).not.toContain("never-show-this");
    expect(view.copyText).toContain("已隐藏敏感信息");
  });
  it.each([null, undefined])("没有结果 %s 时不生成占位交付", (result) => {
    expect(savedRunResultView({ result, outputContract })).toMatchObject({ hasResult: false, outputs: [] });
  });
  it.each([false, 0, "已保存正文", ["依据"]])("标量或列表结果完整保留 %s", (result) => {
    expect(savedRunResultView({ result, outputContract })).toMatchObject({ hasResult: true, outputs: [{ key: "whole-result", label: "交付内容", output: result }] });
  });
  it("空对象不是最终交付正文；空白业务名称使用中文顺序标签", () => {
    expect(savedRunResultView({ result: {}, outputContract }).outputs).toEqual([]);
    const contract = RunView.shape.outputContract.parse({ fields: [{ path: "summary", label: "  ", required: true }] });
    expect(savedRunResultView({ result: { summary: "摘要" }, outputContract: contract }).outputs[0].label).toBe("交付内容 1");
  });
});
