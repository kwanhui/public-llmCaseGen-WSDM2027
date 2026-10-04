"use client";

// Adapted from the response-progress component of SAGE, an earlier demo by
// the same authors.
//
// The demo routes answer one request and return the finished result; they do
// not stream per-stage events. The readout shows what can be known on the
// client: the elapsed time, which is live, and the fixed list of stages the
// request goes through.

import { useEffect, useState } from "react";

export function formatElapsed(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

export function Progress({ label, stages }: { label: string; stages: string[] }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div role="status" aria-live="polite" className="rounded-md bg-muted/60 px-3 py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold">{label}</span>
        {/* The counter ticks ten times a second, so it stays out of the live
            region's announcement; the label and stages are read once. */}
        <span className="tabular-nums text-muted-foreground" aria-hidden="true">
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      <p className="mt-1 leading-snug text-muted-foreground">{stages.join(" → ")}</p>
    </div>
  );
}
