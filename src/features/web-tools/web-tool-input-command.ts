import { z } from "zod";
import { WebToolDesignField } from "./web-tool-design-draft";

const WebToolInputCommand = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), label: WebToolDesignField.shape.label }).strict(),
  z.object({ kind: z.literal("remove"), label: WebToolDesignField.shape.label }).strict(),
  z.object({ kind: z.literal("required"), label: WebToolDesignField.shape.label, required: z.boolean() }).strict(),
]);

function readLabel(value: string) {
  const label = value.trim();
  const quotes = [["「", "」"], ["“", "”"], ['"', '"'], ["'", "'"]] as const;
  const pair = quotes.find(([open]) => label.startsWith(open));
  if (pair) return label.endsWith(pair[1]) ? label.slice(1, -1).trim() : "";
  return quotes.some(([, close]) => label.endsWith(close)) ? "" : label;
}

export function parseWebToolInputCommand(value: string) {
  const instruction = value.trim();
  if (!instruction) return { ok: false as const, message: "填写一条中文快捷指令，再核对具体变更。" };
  if (value.length > 240 || /[\r\n]/u.test(value)) return { ok: false as const, message: "每次只填写一条指令，最多 240 字。" };
  const remove = instruction.match(/^(?:删除|移除|去掉)\s*(.*)$/u);
  const add = instruction.match(/^(?:添加|增加|加一个|(?:我还)?想让(?:员工|用户)填写|让(?:员工|用户)填写)\s*(.*)$/u);
  const requiredInstruction = instruction.replace(/^(?:把|将)\s*/u, "");
  const required = add || remove ? null : requiredInstruction.match(/^(.+?)(?:设为|改为|改成)(必填|选填|必选项)$/u)
    ?? requiredInstruction.match(/^(.+?)(必须填|非必填)$/u);
  const candidate = add ? { kind: "add", label: readLabel(add[1].replace(/^让(?:员工|用户)填写\s*/u, "")) }
    : remove ? { kind: "remove", label: readLabel(remove[1]) }
      : required ? { kind: "required", label: readLabel(required[1]), required: ["必填", "必选项", "必须填"].includes(required[2]) } : null;
  if (!candidate) return { ok: false as const, message: "暂不支持这条指令。请使用添加、删除，或把指定输入项设为必填、选填。" };
  const parsed = WebToolInputCommand.safeParse(candidate);
  return parsed.success ? { ok: true as const, command: parsed.data }
    : { ok: false as const, message: "请填写完整的输入项名称，最多 200 字；如使用引号，请成对填写。" };
}

export function planWebToolInputCommand(value: string, fields: readonly WebToolDesignField[], selectedId = "") {
  const parsed = parseWebToolInputCommand(value);
  const names = new Set(parsed.ok ? [parsed.command.label] : []);
  if (parsed.ok && parsed.command.kind === "required") {
    const literalTarget = value.trim().match(/^(.+?)(?:设为|改为|改成)(?:必填|选填|必选项)$/u)
      ?? value.trim().match(/^(.+?)(?:必须填|非必填)$/u);
    if (literalTarget) {
      const label = WebToolDesignField.shape.label.safeParse(readLabel(literalTarget[1]));
      if (label.success) names.add(label.data);
    }
  }
  const choices = fields.flatMap((field, index) => parsed.ok && parsed.command.kind !== "add"
    && (names.has(field.label.trim()) || names.has(field.name))
    ? [{ id: field.id, label: field.label, position: index + 1 }] : []);
  if (!parsed.ok) return { state: "invalid" as const, message: parsed.message, choices };
  const command = parsed.command;
  if (command.kind === "add") {
    if (fields.length >= 100) return { state: "invalid" as const, message: "最多可设计 100 个输入项，请先移除不需要的项目。", choices };
    if (fields.some((field) => field.label.trim() === command.label)) return { state: "invalid" as const, message: "已有同名输入项，请直接编辑现有项目，或换一个明确的名称。", choices };
    return { state: "ready" as const, command, field: null, choices, message: "新增选填的文本输入项「" + command.label + "」；字段标识自动分配，不改变正式助手。" };
  }
  if (!choices.length) return { state: "invalid" as const, message: "没有找到完全同名的输入项，请核对显示名称或开发者字段标识；不会按部分名称批量修改。", choices };
  if (selectedId && !choices.some((choice) => choice.id === selectedId)) return { state: "invalid" as const, message: "原先选择的输入项已变化，请重新选择目标或修改指令后再核对。", choices };
  if (choices.length > 1 && !selectedId) return { state: "choose" as const, message: "这条指令可对应多个输入项，请明确选择其中一个。", choices };
  const targetId = selectedId || choices[0].id;
  const matches = fields.filter((field) => field.id === targetId);
  if (matches.length !== 1) return { state: "invalid" as const, message: "输入项无法唯一确定，请先核对项目设置。", choices };
  const field = matches[0];
  if (command.kind === "required" && field.required === command.required) return { state: "unchanged" as const, message: "「" + field.label + "」已经是" + (command.required ? "必填" : "选填") + "，无需重复调整。", choices };
  return { state: "ready" as const, command, field, choices, message: command.kind === "remove"
    ? "移除输入项「" + field.label + "」及它的预览填写；确认后才移除。"
    : "将输入项「" + field.label + "」设为" + (command.required ? "必填" : "选填") + "，其他设置和预览填写保留。" };
}
