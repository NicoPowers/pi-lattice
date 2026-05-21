import { useEffect } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "./button.js";
import { cn } from "../../lib/utils.js";

interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  open: boolean;
  title?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export function Dialog({ open, title, onOpenChange, closeOnBackdrop = true, closeOnEscape = true, className, children, ...props }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && closeOnEscape) onOpenChange?.(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange, closeOnEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" onClick={(event) => { if (closeOnBackdrop && event.target === event.currentTarget) onOpenChange?.(false); }}>
      <div className={cn("max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-4 shadow-xl", className)} {...props}>
        <div className="mb-4 flex items-center justify-between gap-4">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          <Button type="button" variant="ghost" onClick={() => onOpenChange?.(false)} aria-label="Close dialog">×</Button>
        </div>
        {children}
      </div>
    </div>
  );
}
