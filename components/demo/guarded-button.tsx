"use client";

import { forwardRef, type ButtonHTMLAttributes, type MouseEvent } from "react";
import { buttonClass } from "@/components/ui/button";

// A button that is switched off with aria-disabled and a guard in its click
// handler rather than with `disabled`. A disabled button loses focus, and the
// browser then puts it on the page body, so a keyboard user pressing Send or
// Generate would start again from the top of the page. This one keeps focus,
// is announced as unavailable, and ignores presses while `off`.
interface GuardedButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> {
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  off?: boolean;
  loading?: boolean;
}

export const GuardedButton = forwardRef<HTMLButtonElement, GuardedButtonProps>(function GuardedButton(
  { variant = "secondary", size = "md", off = false, loading = false, className, onClick, children, ...props },
  ref,
) {
  const inactive = off || loading;
  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={inactive || undefined}
      aria-busy={loading || undefined}
      className={buttonClass(
        variant,
        size,
        [
          "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
          className,
        ].join(" "),
      )}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (inactive) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
