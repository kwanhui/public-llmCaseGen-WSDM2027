"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { GuardedButton } from "./guarded-button";
import type { GuidedBanner } from "./guided-run";

// The step of the guided run. The page's wrapper ([data-step-banner]) holds it
// at the top of the viewport while the page scrolls to each control and result.
//
// Focus moves to the caption when a step starts, so a keyboard or screen-reader
// user starts each step from the banner rather than from the page body. While
// the step runs the banner is aria-busy and Next stays in place, switched off
// with aria-disabled, so that focus on it is not dropped to the page body;
// Stop does the same once pressed. The caption shows two lines at most; the
// whole of it is in its title.
//
// When a step fails the banner stays, its caption says which step stopped and
// why ("Step 2 stopped: ..."), and its buttons become "Retry this step", which
// runs the same step again, and "Stop", which ends the run.
export function StepBanner({
  banner,
  onNext,
  onStop,
  onRetry,
  onEndAfterFailure,
  stopping,
  stepMode,
}: {
  banner: GuidedBanner;
  onNext: () => void;
  onStop: () => void;
  onRetry: () => void;
  onEndAfterFailure: () => void;
  stopping: boolean;
  // Step by step: Next is shown throughout, switched off while a step runs.
  // In play mode the run moves on by itself and there is no Next.
  stepMode: boolean;
}) {
  const { step, total, title, waitingForNext, skipped, failed = false } = banner;
  const captionRef = useRef<HTMLParagraphElement>(null);
  const caption = banner.caption ?? `Step ${step} of ${total}: ${title}`;

  useEffect(() => {
    captionRef.current?.focus({ preventScroll: true });
  }, [step, failed]);

  return (
    <div
      aria-busy={!waitingForNext}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card/95 px-4 py-2 text-card-foreground shadow-md shadow-foreground/5 backdrop-blur",
        failed && "border-flag/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p
          ref={captionRef}
          tabIndex={-1}
          title={caption}
          role={failed ? "alert" : undefined}
          className={cn(
            "-mx-2 min-w-0 basis-full rounded-md px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:basis-0 sm:flex-1",
            // A failure is read in full; other captions keep to two lines.
            failed ? "text-flag" : "line-clamp-2",
          )}
        >
          {caption}
        </p>
        <ol aria-label="Progress of the guided run" className="flex items-center gap-1.5">
          {Array.from({ length: total }, (_, i) => {
            // A conditional step passed over is a hollow disc.
            const notNeeded = skipped.includes(i + 1);
            return (
              <li
                key={i}
                className={cn(
                  "h-2 w-2 rounded-full",
                  notNeeded
                    ? "border border-primary bg-transparent"
                    : i + 1 < step
                      ? "bg-primary"
                      : i + 1 === step
                        ? "bg-primary ring-2 ring-primary/30"
                        : "bg-muted-hover",
                )}
              >
                <span className="sr-only">
                  Step {i + 1}
                  {notNeeded
                    ? " (not needed)"
                    : i + 1 < step
                      ? " (done)"
                      : i + 1 === step
                        ? " (current)"
                        : ""}
                </span>
              </li>
            );
          })}
        </ol>
        {failed ? (
          <>
            <GuardedButton variant="primary" onClick={onRetry} className="h-11 px-4">
              Retry this step
            </GuardedButton>
            <GuardedButton
              variant="ghost"
              size="sm"
              onClick={onEndAfterFailure}
              className="h-11 text-[13px]"
            >
              Stop
            </GuardedButton>
          </>
        ) : (
          <>
            {stepMode || waitingForNext ? (
              <GuardedButton
                variant="primary"
                onClick={onNext}
                off={!waitingForNext}
                className="h-11 min-w-11 px-4"
              >
                Next
              </GuardedButton>
            ) : null}
            <GuardedButton
              variant="ghost"
              size="sm"
              onClick={onStop}
              off={stopping}
              className="h-11 text-[13px]"
            >
              {stopping ? "Stopping after this step" : "Stop after this step"}
            </GuardedButton>
          </>
        )}
      </div>
      {/* A thin line along the foot of the bar: how far the run has gone. */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/10">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${(Math.min(step, total) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
