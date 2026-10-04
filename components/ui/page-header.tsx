import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  action?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, back, action, className }: Props) {
  return (
    <header className={cn("border-b pb-6", className)}>
      {back ? (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden="true">←</span>
          {back.label}
        </Link>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-2xl text-base text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
