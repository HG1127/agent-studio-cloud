import Link from "next/link";
import { Activity, ArrowRight, FlaskConical, Palette, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { href: "/agents", label: "完善流程", description: "定义步骤与交付结果", icon: Palette },
  { href: "/acceptance", label: "自动验收", description: "用固定样例验证结果", icon: FlaskConical },
  { href: "/releases", label: "版本发布", description: "确认候选与正式版本", icon: Rocket },
  { href: "/runs", label: "运行观察", description: "跟踪真实运行结果", icon: Activity },
] as const;

export function QualityJourney({ active }: { active: "acceptance" | "release" }) {
  const activeIndex = active === "acceptance" ? 1 : 2;

  return (
    <section aria-labelledby="quality-journey-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/40">
      <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h2 id="quality-journey-title" className="text-sm font-semibold text-slate-900">从设计到稳定运行</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">每个阶段都保留真实版本与运行证据。</p>
        </div>
        <span className="text-xs font-medium text-indigo-600">当前：{STEPS[activeIndex].label}</span>
      </div>
      <ol className="grid sm:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          const isActive = index === activeIndex;
          const isPast = index < activeIndex;
          return (
            <li key={step.href} className="relative border-b border-slate-100 last:border-b-0 sm:[&:nth-child(odd)]:border-r sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0">
              <Link
                href={step.href}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "group flex min-h-24 items-center gap-3 px-4 py-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500",
                  isActive ? "bg-indigo-50/80" : "hover:bg-slate-50",
                )}
              >
                <span className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl border text-sm font-bold transition-colors",
                  isActive
                    ? "border-indigo-200 bg-indigo-600 text-white shadow-sm"
                    : isPast
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-500 group-hover:border-slate-300",
                )}>
                  <Icon className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", isActive ? "text-indigo-950" : "text-slate-800")}>{index + 1}. {step.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{step.description}</span>
                </span>
                <ArrowRight className={cn("size-4 shrink-0", isActive ? "text-indigo-500" : "text-slate-300 group-hover:text-slate-500")} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
