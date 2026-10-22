import Link from "next/link";
import { ArrowLeft, CircleAlert, FileQuestion, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DetailRecoveryState({
  kind,
  eyebrow,
  title,
  description,
  note,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  onRetry,
}: {
  kind: "missing" | "error";
  eyebrow: string;
  title: string;
  description: string;
  note: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  onRetry?: () => void;
}) {
  const isError = kind === "error";
  const Icon = isError ? CircleAlert : FileQuestion;

  return (
    <main className="page-shell flex min-h-[calc(100vh-58px)] items-center justify-center py-10">
      <section role={isError ? "alert" : undefined} aria-labelledby="detail-recovery-title" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className={`flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:p-6 ${isError ? "border-amber-100 bg-gradient-to-br from-white to-amber-50" : "border-indigo-100 bg-gradient-to-br from-white to-indigo-50"}`}>
          <span className={`grid size-12 shrink-0 place-items-center rounded-2xl ${isError ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>
            <Icon aria-hidden="true" className="size-6" />
          </span>
          <div className="min-w-0">
            <p className={`text-xs font-semibold ${isError ? "text-amber-700" : "text-indigo-700"}`}>{eyebrow}</p>
            <h1 id="detail-recovery-title" className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          </div>
        </div>
        <div className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-500" />
            <p className="text-xs leading-5 text-slate-600">{note}</p>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Link href={primaryHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
              <ArrowLeft aria-hidden="true" className="size-4" />{primaryLabel}
            </Link>
            <Link href={secondaryHref} className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              {secondaryLabel}
            </Link>
            {onRetry ? (
              <Button type="button" variant="secondary" onClick={onRetry} className="sm:ml-auto">
                <RefreshCw aria-hidden="true" className="size-4" />重新读取
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
