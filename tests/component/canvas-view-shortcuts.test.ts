import { afterEach, describe, expect, it } from "vitest";
import { canvasViewShortcut, isCanvasViewShortcutContext } from "@/features/workflow-canvas/canvas-view-shortcuts";

type ViewKey = Parameters<typeof canvasViewShortcut>[0];
const key = (value: string, overrides: Partial<ViewKey> = {}): ViewKey => ({
  key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  defaultPrevented: false, isComposing: false, ...overrides,
});

afterEach(() => { document.body.replaceChildren(); });

describe("仅查看画布的快捷键解析（未执行规格）", () => {
  it.each([
    ["+", "zoom-in"], ["=", "zoom-in"], ["-", "zoom-out"], ["0", "fit-view"],
  ] as const)("画布聚焦时%s支持原键、Ctrl和Command，未聚焦则不接管", (value, action) => {
    for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true, metaKey: true }]) {
      expect(canvasViewShortcut(key(value, modifiers), true)).toBe(action);
      expect(canvasViewShortcut(key(value, modifiers), false)).toBeNull();
    }
  });

  it("实际Shift加号仍可放大，其他Shift组合不占用", () => {
    expect(canvasViewShortcut(key("+", { shiftKey: true }), true)).toBe("zoom-in");
    expect(canvasViewShortcut(key("+", { shiftKey: true, ctrlKey: true }), true)).toBe("zoom-in");
    expect(canvasViewShortcut(key("+", { shiftKey: true, metaKey: true }), true)).toBe("zoom-in");
    for (const value of ["=", "-", "0", "_", ")"]) expect(canvasViewShortcut(key(value, { shiftKey: true }), true)).toBeNull();
  });

  it.each(["+", "=", "-", "0"])("%s不接管已阻止、输入法、Alt或AltGraph组合", (value) => {
    for (const modifiers of [
      { defaultPrevented: true }, { isComposing: true }, { keyCode: 229 },
      { altKey: true }, { altKey: true, ctrlKey: true }, { altKey: true, metaKey: true },
    ]) expect(canvasViewShortcut(key(value, modifiers), true)).toBeNull();
  });

  it("保存、撤销、恢复、节点键盘选择及浏览器其他快捷键完全不解析", () => {
    for (const value of ["s", "S", "z", "Z", "y", "Y", "r", "l", "Enter", " ", "Escape", "Delete", "ArrowLeft", "Tab", "Dead", "Process"]) {
      for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }, { ctrlKey: true, shiftKey: true }]) {
        expect(canvasViewShortcut(key(value, modifiers), true)).toBeNull();
      }
    }
  });

  it("只返回动作，原生事件不被阻止、不改变焦点或调度任何查看/写入", () => {
    const event = new KeyboardEvent("keydown", { key: "=", ctrlKey: true, cancelable: true });
    expect(canvasViewShortcut(event, true)).toBe("zoom-in");
    expect(event.defaultPrevented).toBe(false);
    event.preventDefault();
    expect(canvasViewShortcut(event, true)).toBeNull();
  });
});

function canvas() {
  const root = document.createElement("div");
  root.tabIndex = 0;
  const node = document.createElement("button");
  const label = document.createElement("span");
  label.textContent = "真实节点焦点";
  node.append(label); root.append(node); document.body.append(root);
  return { root, node, label };
}

describe("真实DOM画布焦点上下文（未执行规格）", () => {
  it("可聚焦根、节点按钮及子元素均需属于同一当前画布", () => {
    const { root, node, label } = canvas();
    root.focus();
    expect(isCanvasViewShortcutContext(root, root, document.activeElement)).toBe(true);
    node.focus();
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(true);
    expect(isCanvasViewShortcutContext(root, label, document.activeElement)).toBe(true);
    expect(isCanvasViewShortcutContext(root, label.firstChild, document.activeElement)).toBe(true);
  });

  it("仅事件来源在画布而实际焦点已离开，或另一画布/空来源/卸载，均不能接管浏览器", () => {
    const first = canvas(); const second = canvas();
    first.node.focus();
    expect(isCanvasViewShortcutContext(first.root, second.node, document.activeElement)).toBe(false);
    second.node.focus();
    expect(isCanvasViewShortcutContext(first.root, first.node, document.activeElement)).toBe(false);
    expect(isCanvasViewShortcutContext(first.root, null, document.activeElement)).toBe(false);
    expect(isCanvasViewShortcutContext(first.root, window, document.activeElement)).toBe(false);
    expect(isCanvasViewShortcutContext(null, first.node, first.node)).toBe(false);
    expect(isCanvasViewShortcutContext(first.root, first.node, null)).toBe(false);
    first.root.remove();
    expect(isCanvasViewShortcutContext(first.root, first.node, first.node)).toBe(false);
  });

  it.each(["input", "textarea", "select"])("%s编辑时只保留原表单/浏览器行为", (tag) => {
    const { root, node } = canvas(); const field = document.createElement(tag);
    root.append(field); field.focus();
    expect(isCanvasViewShortcutContext(root, field, document.activeElement)).toBe(false);
    node.focus();
    expect(isCanvasViewShortcutContext(root, field, document.activeElement)).toBe(false);
  });

  it.each(["", "true", "plaintext-only"])("contenteditable=%s及继承的子元素不接管", (value) => {
    const { root, node } = canvas(); const editable = document.createElement("div");
    editable.setAttribute("contenteditable", value); editable.tabIndex = 0;
    const child = document.createElement("span"); editable.append(child); root.append(editable);
    editable.focus();
    expect(isCanvasViewShortcutContext(root, child, document.activeElement)).toBe(false);
    node.focus();
    expect(isCanvasViewShortcutContext(root, child, document.activeElement)).toBe(false);
  });

  it("明确不可编辑的查看元素可用，不把只读文字误当输入", () => {
    const { root, node } = canvas(); node.setAttribute("contenteditable", "false"); node.focus();
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(true);
  });

  it.each(["textbox", "combobox", "dialog", "alertdialog"])("%s角色及其后代不接管", (role) => {
    const { root, node } = canvas(); const context = document.createElement("div");
    context.setAttribute("role", role); node.replaceWith(context); context.append(node); node.focus();
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(false);
  });

  it.each(["dialog", "alertdialog"])("外部打开的%s即便尚未转移焦点也不能触发画布缩放", (role) => {
    const { root, node } = canvas(); node.focus();
    const modal = document.createElement("div"); modal.setAttribute("role", role); modal.setAttribute("data-state", "open"); document.body.append(modal);
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(false);
    modal.remove();
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(true);
  });

  it("原生已打开弹窗和明确模态弹窗阻止，已关闭原生弹窗不影响查看", () => {
    const { root, node } = canvas(); node.focus(); const modal = document.createElement("dialog"); document.body.append(modal);
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(true);
    modal.setAttribute("open", "");
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(false);
    modal.remove(); const explicit = document.createElement("div"); explicit.setAttribute("role", "dialog"); explicit.setAttribute("aria-modal", "true"); document.body.append(explicit);
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(false);
    explicit.setAttribute("aria-hidden", "true");
    expect(isCanvasViewShortcutContext(root, node, document.activeElement)).toBe(true);
  });
});
