"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

export function ReadOnlyDialog({ open, onOpenChange, title, description, children, returnFocusRef, closeLabel = "关闭证据窗口" }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
}) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px]" />
    <Dialog.Content onCloseAutoFocus={(event) => {
      const target = returnFocusRef?.current;
      if (target?.isConnected && !target.hasAttribute("disabled")) { event.preventDefault(); target.focus(); }
    }} className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[calc(100%-3rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-6 py-5"><div className="min-w-0"><Dialog.Title className="break-words text-lg font-bold text-slate-950">{title}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">{description}</Dialog.Description></div><Dialog.Close aria-label={closeLabel} className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"><X aria-hidden className="size-5" /></Dialog.Close></header>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-6">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
