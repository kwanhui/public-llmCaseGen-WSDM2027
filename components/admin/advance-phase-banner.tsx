"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PhaseDefinition } from "@/lib/disciplines/types";
import { EXAMPLE_CASE_TITLE } from "@/components/admin/status-pill";
import { InlineConfirm } from "@/components/admin/inline-confirm";
import { andForAmpersand } from "@/lib/text/display";

interface Props {
  caseId: string;
  status: string;
  phases: PhaseDefinition[];
  currentPhaseId: string | null;
  // Team links that releasing opens. With none, generating team variants is the
  // next action, so Release is not the primary button.
  teamLinkCount: number;
  // Seeded example case: the API refuses release and phase advance for it, so
  // the buttons are disabled rather than left to fail.
  readOnly?: boolean;
}

// The case status is the pill in the page header; this banner says what the
// next step does and asks before doing it, for Release as for the next phase.
export function AdvancePhaseBanner({
  caseId,
  status,
  phases,
  currentPhaseId,
  teamLinkCount,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (status !== "approved" && status !== "released") return null;

  // Titles as the students see them, "&" written out as "and".
  const sorted = [...phases]
    .sort((a, b) => a.order - b.order)
    .map((p) => ({ ...p, studentTitle: andForAmpersand(p.studentTitle) }));
  const currentIdx = sorted.findIndex((p) => p.id === currentPhaseId);
  const total = sorted.length;
  const atLast = currentIdx === total - 1;
  // Where the answer box (with hints and feedback) is, so the instructor knows
  // which phase a team has to reach before the AI help appears.
  const answerIdx = sorted.findIndex((p) => p.activities.includes("answer_attempt"));
  const answerLine =
    answerIdx >= 0
      ? `The answer box, with hints and feedback, opens in phase “${sorted[answerIdx].studentTitle}”.`
      : "No phase has an answer box, so students get no hints or feedback.";

  async function post(path: "release" | "advance-phase", failure: string) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/${path}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      setConfirming(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : failure);
    } finally {
      setBusy(false);
    }
  }

  const title = readOnly ? EXAMPLE_CASE_TITLE : undefined;

  if (status === "approved") {
    const links = `${teamLinkCount} team link${teamLinkCount === 1 ? "" : "s"}`;
    return (
      <div className="rounded-lg border border-primary/25 bg-primary/[0.05] px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-base font-semibold">Release to students</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Releasing opens phase 1 of {total} on every team link. {answerLine}
            </p>
          </div>
          <span title={title}>
            <Button
              variant={teamLinkCount > 0 && !readOnly ? "primary" : "outline"}
              className="whitespace-nowrap"
              onClick={() => setConfirming(true)}
              disabled={busy || confirming || readOnly}
            >
              Release to students
            </Button>
          </span>
        </div>
        {confirming ? (
          <InlineConfirm
            title={teamLinkCount > 0 ? `Release to ${links}?` : "Release with no team links?"}
            action="Release"
            busy={busy}
            onCancel={() => setConfirming(false)}
            onConfirm={() => post("release", "Release failed.")}
          >
            <p>
              {teamLinkCount > 0
                ? "Students can then open the case."
                : "No student can open the case until you generate team variants."}
            </p>
          </InlineConfirm>
        ) : null}
        {err ? <p className="mt-2 text-sm text-flag">{err}</p> : null}
      </div>
    );
  }

  // status === 'released'
  const current = sorted[currentIdx];
  const next = sorted[currentIdx + 1];
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/[0.05] px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">
            {`Phase ${currentIdx + 1} of ${total} is open`}
            {current ? `: ${current.studentTitle.replace(/^\s*\d+[.)]\s*/, "")}` : null}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {atLast
              ? "This is the final phase. Students can now reveal the model answers."
              : `Opening the next phase makes this one read-only; students' answers in it are kept. ${answerLine}`}
          </p>
        </div>
        {atLast ? null : (
          <span title={title}>
            <Button
              variant={readOnly ? "outline" : "primary"}
              className="whitespace-nowrap"
              onClick={() => setConfirming(true)}
              disabled={busy || confirming || readOnly}
            >
              Open the next phase
            </Button>
          </span>
        )}
      </div>
      {confirming && next ? (
        // Opening the next phase cannot be undone: the cohort moves on and their
        // work in the current phase locks. Ask once before it happens.
        <InlineConfirm
          title={`Open the next phase, “${next.studentTitle}”, on every team link?`}
          action="Open the next phase"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => post("advance-phase", "Could not open the next phase.")}
        >
          <p>
            Work in “{current ? current.studentTitle : `phase ${currentIdx + 1}`}” locks to
            read-only and the cohort cannot be moved back.
          </p>
        </InlineConfirm>
      ) : null}
      {err ? <p className="mt-2 text-sm text-flag">{err}</p> : null}
    </div>
  );
}
