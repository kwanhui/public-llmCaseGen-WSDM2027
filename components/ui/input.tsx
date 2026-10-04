import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const BASE = cn(
  "w-full rounded-md border border-input/70 bg-card px-3 text-sm text-foreground shadow-xs",
  "transition-[border-color,box-shadow] duration-150 hover:border-input",
  // Lighter and italic, so an example in an empty field is not mistaken for a value.
  "placeholder:italic placeholder:text-muted-foreground/60",
  "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(BASE, "h-9 py-1", className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(BASE, "min-h-[80px] py-2", className)} {...props} />;
  },
);
