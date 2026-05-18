import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/60", className)} {...props} />;
}
