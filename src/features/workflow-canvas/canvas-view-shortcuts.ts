export type CanvasViewShortcut = "zoom-in" | "zoom-out" | "fit-view";

type CanvasViewKey = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented" | "isComposing"> & { keyCode?: number };

export function canvasViewShortcut(event: CanvasViewKey, canvasFocused: boolean): CanvasViewShortcut | null {
  if (!canvasFocused || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey) return null;
  if (event.shiftKey && event.key !== "+") return null;
  if (event.key === "+" || event.key === "=") return "zoom-in";
  if (event.key === "-") return "zoom-out";
  if (event.key === "0") return "fit-view";
  return null;
}

const BLOCKED_CONTEXT = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="dialog"],[role="alertdialog"],dialog';
const OPEN_MODAL = 'dialog[open],[role="dialog"][data-state="open"],[role="alertdialog"][data-state="open"],[aria-modal="true"]:not([aria-hidden="true"])';

export function isCanvasViewShortcutContext(canvas: HTMLElement | null, target: EventTarget | null, activeElement: Element | null): boolean {
  if (!canvas?.isConnected || !activeElement || !canvas.contains(activeElement)) return false;
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!element || !canvas.contains(element) || element.closest(BLOCKED_CONTEXT) || activeElement.closest(BLOCKED_CONTEXT)) return false;
  return canvas.ownerDocument.querySelector(OPEN_MODAL) === null;
}
