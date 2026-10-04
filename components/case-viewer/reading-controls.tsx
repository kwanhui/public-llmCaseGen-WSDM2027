"use client";

import { useCallback, useSyncExternalStore } from "react";

// Student-facing reading controls. Case scenarios run several hundred words and
// a fixed size and spacing do not suit every reader: a learner with low vision,
// dyslexia, or simply a small phone benefits from larger text and looser
// spacing. Preferences are kept in localStorage (no account, nothing stored
// server-side). The store is read through useSyncExternalStore so the value is
// SSR-safe (server renders the default) with no hydration mismatch.

export interface ReadingPrefs {
  scale: "base" | "lg" | "xl";
  comfort: boolean;
}

const STORAGE_KEY = "perscase-reading-prefs";
const CHANGE_EVENT = "perscase-reading-change";
const DEFAULTS: ReadingPrefs = { scale: "base", comfort: false };

export const SCALE_REM: Record<ReadingPrefs["scale"], string> = {
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
};

function parsePrefs(raw: string): ReadingPrefs {
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingPrefs>;
    return {
      scale: parsed.scale === "lg" || parsed.scale === "xl" ? parsed.scale : "base",
      comfort: parsed.comfort === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function getSnapshot(): string {
  return window.localStorage.getItem(STORAGE_KEY) ?? "";
}

function getServerSnapshot(): string {
  return "";
}

// Returns the current reading preferences and a setter that persists them.
export function useReadingPrefs(): [ReadingPrefs, (next: ReadingPrefs) => void] {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const prefs = parsePrefs(raw);
  const set = useCallback((next: ReadingPrefs) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // private mode or storage disabled: the preference does not persist
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [prefs, set];
}

export function ReadingControls({
  prefs,
  onChange,
}: {
  prefs: ReadingPrefs;
  onChange: (p: ReadingPrefs) => void;
}) {
  const order: ReadingPrefs["scale"][] = ["base", "lg", "xl"];
  const idx = order.indexOf(prefs.scale);

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]" role="group" aria-label="Text size">
      <span className="text-muted-foreground">Text size:</span>
      <button
        type="button"
        className="min-h-[44px] min-w-[44px] rounded-md border border-input/70 bg-card px-3 font-semibold shadow-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={() => onChange({ ...prefs, scale: order[Math.max(0, idx - 1)] })}
        disabled={idx <= 0}
        aria-label="Decrease text size"
      >
        A−
      </button>
      <button
        type="button"
        className="min-h-[44px] min-w-[44px] rounded-md border border-input/70 bg-card px-3 font-semibold shadow-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
        onClick={() => onChange({ ...prefs, scale: order[Math.min(order.length - 1, idx + 1)] })}
        disabled={idx >= order.length - 1}
        aria-label="Increase text size"
      >
        A+
      </button>
      <button
        type="button"
        className={
          prefs.comfort
            ? "min-h-[44px] rounded-md border border-student/50 bg-student/10 px-3 font-medium text-student transition-colors"
            : "min-h-[44px] rounded-md border border-input/70 bg-card px-3 font-medium shadow-xs transition-colors hover:bg-muted"
        }
        onClick={() => onChange({ ...prefs, comfort: !prefs.comfort })}
        aria-pressed={prefs.comfort}
      >
        Wider line spacing
      </button>
    </div>
  );
}
