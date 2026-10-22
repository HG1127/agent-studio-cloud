import { describe, expect, it } from "vitest";
import { WebToolDesignField } from "./web-tool-design-draft";
import { parseWebToolInputCommand, planWebToolInputCommand } from "./web-tool-input-command";

const field = (id = "input-1", label = "下周计划", required = true) => WebToolDesignField.parse({
  id, name: id.replaceAll("-", "_"), label, type: "string", required, rows: 3, placeholder: "保留填写提示", description: "保留说明",
});

describe("网页工具中文快捷指令", () => {
  it.each(["添加「本周收获」", "增加“本周收获”", '加一个"本周收获"', "加一个让员工填写「本周收获」", "我还想让员工填写本周收获", "让用户填写本周收获"])("识别明确的添加指令：%s", (value) => {
    expect(parseWebToolInputCommand(value)).toEqual({ ok: true, command: { kind: "add", label: "本周收获" } });
  });

  it.each(["删除下周计划", "移除「下周计划」", "去掉 下周计划"])("识别完整名称的移除指令：%s", (value) => {
    expect(parseWebToolInputCommand(value)).toEqual({ ok: true, command: { kind: "remove", label: "下周计划" } });
  });

  it.each([
    ["把下周计划设为必填", true], ["将「下周计划」改为选填", false], ["下周计划改成必填", true],
    ["下周计划必须填", true], ["下周计划非必填", false], ["把下周计划设为必选项", true],
  ] as const)("必填语法有完整目标而非空匹配：%s", (value, required) => {
    expect(parseWebToolInputCommand(value)).toEqual({ ok: true, command: { kind: "required", label: "下周计划", required } });
  });

  it.each(["", " ", "帮我优化表单", "把全部字段删掉", "删除", "添加", "把设为必填", "将设为选填", "加一个让员工填写", "删除下周计划\n添加其他项", "添加「没有闭合", "添加没有开头」", "添加「」", "添加" + "字".repeat(201), "添加" + "字".repeat(241)])("不识别或超长指令不猜测添加：%s", (value) => {
    expect(parseWebToolInputCommand(value).ok).toBe(false);
  });

  it("名称中的操作词不改变开头明确的命令", () => {
    expect(parseWebToolInputCommand("添加「下周计划设为必填」")).toEqual({ ok: true, command: { kind: "add", label: "下周计划设为必填" } });
    expect(parseWebToolInputCommand("删除「将计划改为选填」")).toEqual({ ok: true, command: { kind: "remove", label: "将计划改为选填" } });
  });

  it("规划新增选填文本，不生成标识或修改当前输入项", () => {
    const fields = [field()];
    expect(planWebToolInputCommand("添加 本周收获", fields)).toMatchObject({ state: "ready", command: { kind: "add", label: "本周收获" }, field: null });
    expect(fields).toEqual([field()]);
  });

  it("拒绝同名新增以及超过一百项，不覆盖已有项", () => {
    expect(planWebToolInputCommand("添加 下周计划", [field()])).toMatchObject({ state: "invalid", message: expect.stringContaining("同名") });
    const fields = Array.from({ length: 100 }, (_, index) => field("input-" + index, "项目" + index));
    expect(planWebToolInputCommand("添加 本周收获", fields)).toMatchObject({ state: "invalid", message: expect.stringContaining("100") });
    expect(fields).toHaveLength(100);
  });

  it.each(["删除计划", "把周计划设为选填"])("部分名称不命中已有项目：%s", (value) => {
    expect(planWebToolInputCommand(value, [field()])).toMatchObject({ state: "invalid", message: expect.stringContaining("完全同名") });
  });

  it("可按完整开发者字段名定位，但不会按片段批量调整", () => {
    const target = field();
    expect(planWebToolInputCommand("把input_1设为选填", [target])).toMatchObject({ state: "ready", field: target, command: { kind: "required", required: false } });
    expect(planWebToolInputCommand("删除input", [target])).toMatchObject({ state: "invalid" });
  });

  it("重名时先选择具体项目，不能默认选第一个或全部修改", () => {
    const fields = [field("input-1"), field("input-2")];
    expect(planWebToolInputCommand("把下周计划设为选填", fields)).toMatchObject({ state: "choose", choices: [
      { id: "input-1", position: 1 }, { id: "input-2", position: 2 },
    ] });
    expect(planWebToolInputCommand("把下周计划设为选填", fields, "input-2")).toMatchObject({ state: "ready", field: fields[1] });
    expect(fields.every((entry) => entry.required)).toBe(true);
  });

  it("目标选择过期时不换成其他同名项目", () => {
    expect(planWebToolInputCommand("删除下周计划", [field("input-1")], "input-2")).toMatchObject({ state: "invalid", message: expect.stringContaining("已变化") });
  });

  it.each([["将军", "军"], ["把手", "手"]])("%s同时可能是名称和句式前缀时要求选择，引用完整名称可明确定位", (literal, abbreviated) => {
    const fields = [field("input-1", literal), field("input-2", abbreviated)];
    expect(planWebToolInputCommand(literal + "设为选填", fields)).toMatchObject({ state: "choose", choices: [{ id: "input-1" }, { id: "input-2" }] });
    expect(planWebToolInputCommand(literal + "设为选填", fields, "input-1")).toMatchObject({ state: "ready", field: fields[0] });
    expect(planWebToolInputCommand("把「" + literal + "」设为选填", fields)).toMatchObject({ state: "ready", field: fields[0], choices: [{ id: "input-1" }] });
  });

  it("带句式前缀的引号名称不会将未填名称的草稿误列为候选", () => {
    const target = field("input-1", "将军");
    const unnamed = { ...field("input-2"), label: "" };
    expect(planWebToolInputCommand("把「将军」设为选填", [target, unnamed])).toMatchObject({ state: "ready", field: target, choices: [{ id: "input-1" }] });
  });

  it("重复标识无法唯一定位时拒绝修改", () => {
    expect(planWebToolInputCommand("删除下周计划", [field(), field("input-1", "其他事项")])).toMatchObject({ state: "invalid", message: expect.stringContaining("唯一") });
  });

  it.each([[true, "必填"], [false, "选填"]] as const)("已经是%s时只反馈无需调整", (required, label) => {
    expect(planWebToolInputCommand("把下周计划设为" + label, [field("input-1", "下周计划", required)])).toMatchObject({ state: "unchanged", message: expect.stringContaining("无需重复调整") });
  });

  it("规划支持冻结输入，保留类型、提示、说明和原顺序", () => {
    const fields = Object.freeze([Object.freeze(field()), Object.freeze(field("input-2", "本周收获"))]);
    const before = JSON.stringify(fields);
    for (const value of ["添加备注", "删除下周计划", "把下周计划设为选填", "无法识别"]) planWebToolInputCommand(value, fields);
    expect(JSON.stringify(fields)).toBe(before);
  });
});
