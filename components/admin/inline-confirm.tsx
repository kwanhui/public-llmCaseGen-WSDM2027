"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CARD } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

// The one confirmation on the admin pages: an inline panel under the control
// that asked, with Cancel and the action. It replaces the browser pop-up, which
// some readers took for a site error, which could not list what an action
// affects, and which screen readers and Playwright do not see as page content.
// Approve, Release, Open the next phase and Delete all use it.
export function InlineConfirm({
  title,
  children,
  action,
  busy = false,
  danger = false,
  onCancel,
  onConfirm,
  className,
}: {
  // The question, for example "Delete this case?".
  title: string;
  // What the action does or affects, under the question.
  children?: ReactNode;
  // The confirm button's label, for example "Delete".
  action: string;
  busy?: boolean;
  // A destructive action gets the flag colour.
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  className?: string;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the panel when it opens, on the safe choice, so a
  // keyboard or screen-reader user lands on the question. Escape cancels.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
      className={cn(
        CARD,
        "mt-3 px-4 py-3 text-sm",
        danger ? "border-flag/40" : "border-primary/30",
        className,
      )}
    >
      <p id={titleId} className="font-medium text-foreground">
        {title}
      </p>
      {children ? (
        <div id={bodyId} className="mt-1 space-y-1 text-muted-foreground">
          {children}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          size="sm"
          onClick={onConfirm}
          loading={busy}
          disabled={busy}
        >
          {action}
        </Button>
      </div>
    </div>
  );
}
