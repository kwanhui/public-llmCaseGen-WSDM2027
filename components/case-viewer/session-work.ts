"use client";

import { useMemo, useSyncExternalStore } from "react";

// What the student's page is holding: the text in each box, and the hints and
// feedback they have asked for. The text lives here for the tab's lifetime (the
// server keeps the saved copy). Hints and feedback are also kept in this
// browser's localStorage, keyed by the case link and the phase, so a reload
// shows them again and the hint sequence carries on where it stopped. "Download
// my work" reads from here so the file matches what is on the screen.

export interface SessionFeedback {
  criteria: { criterion: string; judgment: string; nextStep?: string; addressed?: boolean }[];
  // The judgement against the criteria, and one sentence on what to do next
  // (older feedback has no nextStep).
  overall: string;
  nextStep?: string;
  band: string;
  // Set only when the answer looks as though it identifies a real person or
  // place, or when the writer disclosed something of their own. Both are shown
  // above the criteria and neither is assessed.
  safetyNote?: string;
  disclosureNote?: string;
  // The discipline checks the answer triggered, shown above the band, and the
  // number of criteria the rubric names.
  flags?: string[];
  criteriaTotal?: number;
}

// The discipline checks of an assessment, and its safety note without the
// "Checks: ..." copy of them that assessAttempt prepends for views that do not
// read flags (the instructor's list and the Markdown export).
export function feedbackChecks(feedback: SessionFeedback): { flags: string[]; safetyNote: string } {
  const flags = (feedback.flags ?? []).map((f) => f.trim()).filter(Boolean);
  let note = feedback.safetyNote?.trim() ?? "";
  const copy = `Checks: ${flags.join(" ")}`;
  if (flags.length > 0 && note.startsWith(copy)) note = note.slice(copy.length).trim();
  return { flags, safetyNote: note };
}

// How many criteria the answer was rated on: the entries it addressed.
export function criteriaRated(feedback: SessionFeedback): number {
  return feedback.criteria.filter((c) => c.addressed !== false).length;
}

export interface PhaseHelp {
  hints: string[];
  feedback: SessionFeedback | null;
  // True once an answer has been sent for feedback in this phase, whatever
  // came back; the model answers unlock on it.
  sent: boolean;
}

const EMPTY_HELP: PhaseHelp = { hints: [], feedback: null, sent: false };

const texts = new Map<string, string>();
const lists = new Map<string, string[]>();

function key(phaseId: string, activityType: string): string {
  return `${phaseId}:${activityType}`;
}

export function setSessionText(phaseId: string, activityType: string, text: string): void {
  texts.set(key(phaseId, activityType), text);
}

export function getSessionText(phaseId: string, activityType: string): string | undefined {
  return texts.get(key(phaseId, activityType));
}

export function setSessionList(phaseId: string, activityType: string, items: string[]): void {
  lists.set(key(phaseId, activityType), items);
}

export function getSessionList(phaseId: string, activityType: string): string[] | undefined {
  return lists.get(key(phaseId, activityType));
}

// Hints and feedback per case link and phase. The in-memory copy is the one
// the page reads, so the page still works when storage is blocked (private
// mode); localStorage only carries it across a reload.
const HELP_EVENT = "perscase-help-change";
const helpRaw = new Map<string, string>();

function helpKey(token: string, phaseId: string): string {
  return `perscase-help:${token}:${phaseId}`;
}

function readHelpRaw(k: string): string {
  const cached = helpRaw.get(k);
  if (cached !== undefined) return cached;
  let raw = "";
  try {
    raw = window.localStorage.getItem(k) ?? "";
  } catch {
    // storage blocked: start empty
  }
  helpRaw.set(k, raw);
  return raw;
}

function parseHelp(raw: string): PhaseHelp {
  if (!raw) return EMPTY_HELP;
  try {
    const p = JSON.parse(raw) as Partial<PhaseHelp>;
    return {
      hints: Array.isArray(p.hints) ? p.hints.filter((h): h is string => typeof h === "string") : [],
      feedback: p.feedback && Array.isArray(p.feedback.criteria) ? p.feedback : null,
      sent: p.sent === true || !!p.feedback,
    };
  } catch {
    return EMPTY_HELP;
  }
}

export function setPhaseHelp(token: string, phaseId: string, next: PhaseHelp): void {
  const k = helpKey(token, phaseId);
  const raw = JSON.stringify(next);
  helpRaw.set(k, raw);
  try {
    window.localStorage.setItem(k, raw);
  } catch {
    // storage blocked: the help lasts as long as the tab
  }
  window.dispatchEvent(new Event(HELP_EVENT));
}

export function getPhaseHelp(token: string, phaseId: string): PhaseHelp {
  return parseHelp(readHelpRaw(helpKey(token, phaseId)));
}

function subscribeHelp(cb: () => void): () => void {
  window.addEventListener(HELP_EVENT, cb);
  return () => window.removeEventListener(HELP_EVENT, cb);
}

// The phase's hints and feedback, read through useSyncExternalStore so the
// server render (nothing stored) and the first client render agree.
export function usePhaseHelp(token: string, phaseId: string): PhaseHelp {
  const k = helpKey(token, phaseId);
  const raw = useSyncExternalStore(
    subscribeHelp,
    () => readHelpRaw(k),
    () => "",
  );
  return useMemo(() => parseHelp(raw), [raw]);
}
