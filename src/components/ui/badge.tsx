import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    tone: {
      neutral: "border-slate-200 bg-slate-50 text-slate-600",
      info: "border-indigo-100 bg-indigo-50 text-indigo-700",
      success: "border-emerald-100 bg-emerald-50 text-emerald-700",
      warning: "border-amber-100 bg-amber-50 text-amber-700",
      danger: "border-red-100 bg-red-50 text-red-700",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
