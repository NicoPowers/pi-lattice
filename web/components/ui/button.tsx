import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils.js";

type ButtonVariant = "default" | "secondary" | "destructive" | "ghost";

const variants: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground border-primary hover:brightness-110",
  secondary: "bg-transparent text-foreground border-border hover:bg-white/5",
  destructive: "bg-destructive/15 text-destructive border-destructive hover:bg-destructive/25",
  ghost: "bg-transparent text-foreground border-transparent hover:bg-white/5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ className, variant = "default", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
