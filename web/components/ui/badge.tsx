import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

type BadgeVariant = "default" | "success" | "warning" | "destructive" | "outline";

const variants: Record<BadgeVariant, string> = {
  default: "bg-primary/15 text-primary",
  success: "bg-emerald-400/15 text-emerald-300",
  warning: "bg-amber-400/15 text-amber-300",
  destructive: "bg-destructive/15 text-destructive",
  outline: "border border-border text-muted-foreground",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", variants[variant], className)} {...props} />;
}
