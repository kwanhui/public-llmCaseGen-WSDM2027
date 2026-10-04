import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

// Hierarchy: primary is filled, secondary is tonal on the muted surface,
// outline sits on the card surface with a hairline, ghost has no fill until
// hovered. Every hover and pressed state keeps text contrast at AA.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-hover active:shadow-none",
  secondary: "bg-muted text-foreground hover:bg-muted-hover active:bg-muted-hover/80",
  ghost: "text-foreground hover:bg-muted active:bg-muted-hover",
  danger:
    "border border-flag/40 bg-card text-flag shadow-xs hover:bg-flag/5 active:bg-flag/10 active:shadow-none",
  outline:
    "border border-input/70 bg-card text-foreground shadow-xs hover:bg-muted active:bg-muted-hover active:shadow-none",
};

// Heights: 32 px small, 36 px medium, 44 px large.
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

const BASE = [
  "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold",
  "transition-[background-color,box-shadow,transform] duration-150 active:translate-y-px",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:pointer-events-none disabled:opacity-50",
];

// The same look for a link, so that a link is not wrapped around a button.
export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
