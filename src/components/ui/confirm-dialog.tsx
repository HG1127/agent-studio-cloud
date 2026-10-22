"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, X } from "lucide-react";
import type { RefObject } from "react";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, pending = false, tone = "danger", returnFocusRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  tone?: "danger" | "warning";
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const danger = tone === "danger";
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <Dialog.Content onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (target?.isConnected && !target.hasAttribute("disabled")) { event.preventDefault(); target.focus(); }
        }} className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl outline-none sm:p-6">
          <div className="flex items-start gap-3">
            <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${danger ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}><AlertTriangle className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="break-words text-base font-bold text-slate-950">{title}</Dialog.Title>
              <Dialog.Description className="mt-2 break-words text-sm leading-6 text-slate-600">{description}</Dialog.Description>
            </div>
            <Dialog.Close aria-label="关闭确认弹窗" disabled={pending} className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><X className="size-4" /></Dialog.Close>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close disabled={pending} className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">返回</Dialog.Close>
            <button type="button" disabled={pending} onClick={onConfirm} className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-700 hover:bg-amber-800"}`}>{pending ? "正在处理…" : confirmLabel}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
