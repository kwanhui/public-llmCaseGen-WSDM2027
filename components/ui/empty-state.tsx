import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  variant?: "default" | "muted";
}

export function EmptyState({ title, description, action, className, variant = "default" }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border px-6 py-12 text-center",
        variant === "muted" ? "border-transparent bg-muted" : "border-dashed bg-card",
        className,
      )}
    >
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
