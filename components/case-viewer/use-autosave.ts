"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatClockTime } from "@/lib/format-date";

// Autosave for the student activity boxes.
//
// Two timers run together: one fires a second after typing stops, the other at
// most five seconds after the first unsaved keystroke, so a student who types
// without pausing still has their work saved. The status is live rather than a
// standing claim, so the page never says "saved" about text that is not.
//
// A write refused because the instructor has just advanced the phase is
// reported to the student with the text left in the box to copy.

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "retrying" }
  | { kind: "failed"; message: string };

const PAUSE_MS = 1000;
const MAX_INTERVAL_MS = 5000;

// Text the server would not take. The phase card it was typed in is about to
// become read-only, so the viewer shows it where the student can still copy it.
export interface UnsavedWork {
  phaseId: string;
  activityType: string;
  text: string;
  message: string;
}

// Every mounted box registers a flush here so the viewer can push pending text
// to the server before it switches to the next phase.
const flushers = new Set<() => Promise<UnsavedWork | null>>();

export async function flushPendingSaves(): Promise<void> {
  await Promise.all(Array.from(flushers).map((f) => f().catch(() => null)));
}

// A refused write is reported to the viewer as well as to the box it came from,
// because the box is often about to be replaced by the read-only version of a
// phase that has just closed.
const refusalListeners = new Set<(work: UnsavedWork) => void>();

export function onSaveRefused(cb: (work: UnsavedWork) => void): () => void {
  refusalListeners.add(cb);
  return () => {
    refusalListeners.delete(cb);
  };
}

// The student's text out of the stored shape, for the copy-it-now banner.
function contentToText(content: unknown): string {
  const c = content as { text?: string; items?: string[] } | null;
  if (!c) return "";
  if (Array.isArray(c.items)) return c.items.join("\n");
  return c.text ?? "";
}

export function statusLabel(status: SaveStatus): string {
  switch (status.kind) {
    case "unsaved":
      return "Not saved yet";
    case "saving":
      return "Saving…";
    case "saved":
      return `Saved ${formatClockTime(status.at)}`;
    case "retrying":
      return "Not saved: retrying";
    case "failed":
      return "Not saved";
    default:
      return "";
  }
}

// One saved indicator per phase. Each box publishes its status here, and the
// phase shows a single line that sums them up: the worst state wins (not
// saved, then saving, then unsaved), otherwise the latest save time. It also
// records whether the phase's answer (or any box) has been saved at least once,
// and how many words the last saved answer held, for the "finished" line on the
// last phase.
const phaseStatuses = new Map<string, SaveStatus>();
const everSaved = new Set<string>();
const savedWords = new Map<string, number>();

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
const statusListeners = new Set<() => void>();

function publishStatus(
  phaseId: string,
  activityType: string,
  status: SaveStatus,
  stored: boolean,
  storedWords: number,
) {
  const k = `${phaseId}:${activityType}`;
  phaseStatuses.set(k, status);
  if (status.kind === "saved" || stored) everSaved.add(k);
  if (stored && !savedWords.has(k)) savedWords.set(k, storedWords);
  for (const cb of statusListeners) cb();
}

function subscribeStatus(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

const RANK: Record<SaveStatus["kind"], number> = {
  failed: 5,
  retrying: 4,
  saving: 3,
  unsaved: 2,
  saved: 1,
  idle: 0,
};

function phaseSnapshot(phaseId: string): string {
  let worst: SaveStatus = { kind: "idle" };
  let latest: Date | null = null;
  let anySaved = false;
  for (const [k, st] of phaseStatuses) {
    if (!k.startsWith(`${phaseId}:`)) continue;
    if (st.kind === "saved" && (!latest || st.at > latest)) latest = st.at;
    if (RANK[st.kind] > RANK[worst.kind]) worst = st;
  }
  for (const k of everSaved) if (k.startsWith(`${phaseId}:`)) anySaved = true;
  const answerSaved = everSaved.has(`${phaseId}:answer_attempt`);
  const answerWords = savedWords.get(`${phaseId}:answer_attempt`) ?? 0;
  const shown: SaveStatus = worst.kind === "saved" && latest ? { kind: "saved", at: latest } : worst;
  return JSON.stringify({
    kind: shown.kind,
    label: statusLabel(shown),
    answerSaved,
    anySaved,
    answerWords,
  });
}

export interface PhaseSaveSummary {
  kind: SaveStatus["kind"];
  label: string;
  answerSaved: boolean;
  anySaved: boolean;
  // Words in the answer as last saved (0 before any save).
  answerWords: number;
}

const IDLE_SUMMARY = JSON.stringify({
  kind: "idle",
  label: "",
  answerSaved: false,
  anySaved: false,
  answerWords: 0,
});

export function usePhaseSaveSummary(phaseId: string): PhaseSaveSummary {
  const raw = useSyncExternalStore(
    subscribeStatus,
    () => phaseSnapshot(phaseId),
    () => IDLE_SUMMARY,
  );
  return JSON.parse(raw) as PhaseSaveSummary;
}

export function useAutosave(opts: {
  token: string;
  phaseId: string;
  activityType: "clarifying_questions" | "notes" | "answer_attempt";
  enabled: boolean;
  // The box opened with text the server already holds, and how many words.
  hasStoredText?: boolean;
  storedWords?: number;
}) {
  const { token, phaseId, activityType, enabled, hasStoredText = false, storedWords = 0 } = opts;
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

  useEffect(() => {
    publishStatus(phaseId, activityType, status, hasStoredText, storedWords);
  }, [phaseId, activityType, status, hasStoredText, storedWords]);
  const pending = useRef<unknown>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback(
    async (contentJson: unknown): Promise<UnsavedWork | null> => {
      setStatus({ kind: "saving" });
      const refuse = (message: string): UnsavedWork => {
        setStatus({ kind: "failed", message });
        const work = {
          phaseId,
          activityType,
          text: contentToText(contentJson),
          message,
        };
        for (const cb of refusalListeners) cb(work);
        return work;
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`/api/case/${token}/responses`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phaseId, activityType, contentJson }),
          });
          if (res.status === 403) {
            const data = (await res.json().catch(() => ({}))) as { message?: string };
            return refuse(
              data.message ??
                "This phase has closed, so the text was not saved. Copy it before you leave the page.",
            );
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          savedWords.set(`${phaseId}:${activityType}`, countWords(contentToText(contentJson)));
          setStatus({ kind: "saved", at: new Date() });
          return null;
        } catch {
          if (attempt < 2) {
            setStatus({ kind: "retrying" });
            await new Promise((r) => setTimeout(r, 1200));
          }
        }
      }
      return refuse(
        "The text was not saved. Check your connection, and copy your text before you leave the page.",
      );
    },
    [token, phaseId, activityType],
  );

  const run = useCallback(() => {
    if (pauseTimer.current) {
      clearTimeout(pauseTimer.current);
      pauseTimer.current = null;
    }
    if (maxTimer.current) {
      clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
    const content = pending.current;
    if (content === null) return;
    pending.current = null;
    void write(content);
  }, [write]);

  const schedule = useCallback(
    (contentJson: unknown) => {
      if (!enabled) return;
      pending.current = contentJson;
      setStatus((s) => (s.kind === "saving" ? s : { kind: "unsaved" }));
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      pauseTimer.current = setTimeout(run, PAUSE_MS);
      if (!maxTimer.current) maxTimer.current = setTimeout(run, MAX_INTERVAL_MS);
    },
    [enabled, run],
  );

  const flush = useCallback(async (): Promise<UnsavedWork | null> => {
    if (pauseTimer.current) {
      clearTimeout(pauseTimer.current);
      pauseTimer.current = null;
    }
    if (maxTimer.current) {
      clearTimeout(maxTimer.current);
      maxTimer.current = null;
    }
    const content = pending.current;
    if (content === null) return null;
    pending.current = null;
    return write(content);
  }, [write]);

  useEffect(() => {
    if (!enabled) return;
    const fn = () => flush();
    flushers.add(fn);
    return () => {
      flushers.delete(fn);
    };
  }, [enabled, flush]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pending.current !== null) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  return { status, schedule, flush, label: statusLabel(status) };
}
