"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { PhaseDefinition, ActivityType } from "@/lib/disciplines/types";
import { InlineConfirm } from "@/components/admin/inline-confirm";
import { CARD, LABEL } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

interface Props {
  caseId: string;
  initialPhases: PhaseDefinition[];
  defaultPhases: PhaseDefinition[];
  // Seeded example case: nothing can be edited.
  disabled: boolean;
  status: string;
  // The phase the cohort is on once the case is released. That phase and the
  // ones before it have been opened and stay as they are; later phases can
  // still be edited, and students see the change when the phase opens.
  currentPhaseId: string | null;
}

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  clarifying_questions: "Clarifying questions",
  notes: "Notes",
  answer_attempt:
    "Answer box, with AI hints, AI feedback and, in the last phase, the model answers",
};

export function PhaseEditor({
  caseId,
  initialPhases,
  defaultPhases,
  disabled,
  status,
  currentPhaseId,
}: Props) {
  const router = useRouter();
  const [phases, setPhases] = useState<PhaseDefinition[]>(
    [...initialPhases].sort((a, b) => a.order - b.order),
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [confirmingReset, setConfirmingReset] = useState(false);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = useCallback(
    async (next: PhaseDefinition[]) => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/admin/cases/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phasesJson: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSaveState("saved");
        dirty.current = false;
        setTimeout(() => setSaveState("idle"), 1500);
      } catch {
        setSaveState("error");
      }
    },
    [caseId],
  );

  function schedule(next: PhaseDefinition[]) {
    dirty.current = true;
    setPhases(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(next), 1500);
  }

  function updatePhase(id: string, patch: Partial<PhaseDefinition>) {
    schedule(phases.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function move(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= phases.length) return;
    const swapped = phases.slice();
    [swapped[idx], swapped[target]] = [swapped[target], swapped[idx]];
    const renumbered = swapped.map((p, i) => ({ ...p, order: i }));
    schedule(renumbered);
  }

  function remove(id: string) {
    if (phases.length <= 1) return;
    const filtered = phases.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i }));
    schedule(filtered);
  }

  function addPhase() {
    const next: PhaseDefinition = {
      id: crypto.randomUUID(),
      order: phases.length,
      label: "New phase",
      studentTitle: `${phases.length + 1}. New phase`,
      studentPrompt: "Write the prompt students will see for this phase.",
      activities: ["notes"],
    };
    schedule([...phases, next]);
  }

  function resetToDefault() {
    setConfirmingReset(false);
    const cloned = JSON.parse(JSON.stringify(defaultPhases)) as PhaseDefinition[];
    schedule(cloned);
    router.refresh();
  }

  function toggleActivity(id: string, a: ActivityType) {
    const phase = phases.find((p) => p.id === id);
    if (!phase) return;
    const has = phase.activities.includes(a);
    const next = has
      ? phase.activities.filter((x) => x !== a)
      : [...phase.activities, a];
    updatePhase(id, { activities: next });
  }

  const answerIdx = phases.findIndex((p) => p.activities.includes("answer_attempt"));
  const released = status === "released";
  // The banner above names the answer-box phase once the case is approved, so
  // the intro says it only before then.
  const bannerShown = status === "approved" || released;
  // Index of the last opened phase; -1 before release.
  const openedIdx = released
    ? Math.max(
        0,
        phases.findIndex((p) => p.id === currentPhaseId),
      )
    : -1;
  const isOpened = (i: number) => i <= openedIdx;
  // Resetting would replace opened phases, so it stops at release. Moves stay
  // among the phases not yet opened.
  const structureLocked = disabled || released;

  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Phases</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Students see one phase at a time, and you open the next phase for the whole
            cohort.
            {released ? " Changes apply to phases not yet opened." : null}
            {bannerShown
              ? null
              : answerIdx >= 0
                ? ` The answer box, with hints and feedback, is in phase ${answerIdx + 1}.`
                : " No phase has an answer box, so students get no hints or feedback."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              saveState === "error"
                ? "text-sm text-flag"
                : saveState === "saved"
                  ? "text-sm text-primary"
                  : "text-sm text-muted-foreground"
            }
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? "Saved"
                : saveState === "error"
                  ? "Save failed"
                  : ""}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirmingReset(true)}
            disabled={structureLocked || confirmingReset}
          >
            Reset to default
          </Button>
        </div>
      </header>
      {confirmingReset ? (
        <div className="border-b px-4 pb-3 sm:px-5">
          <InlineConfirm
            title="Reset all phases to the discipline default?"
            action="Reset"
            onCancel={() => setConfirmingReset(false)}
            onConfirm={resetToDefault}
          >
            <p>Your edits to the phases will be lost.</p>
          </InlineConfirm>
        </div>
      ) : null}
      <ol className="divide-y">
        {phases.map((p, i) => {
          const fieldLocked = disabled || isOpened(i);
          return (
          <li key={p.id} className="space-y-3 px-4 py-4 sm:px-5">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                {i + 1}
              </span>
              {/* One title per phase, in the form students see ("2. Gather and
                  inspect the financials"). The short label kept for the stepper
                  and the prompts follows it, without the number. */}
              <Input
                value={p.studentTitle}
                onChange={(e) =>
                  updatePhase(p.id, {
                    studentTitle: e.target.value,
                    label: e.target.value.replace(/^\s*\d+[.)]\s*/, "").trim() || e.target.value,
                  })
                }
                disabled={fieldLocked}
                aria-label={`Phase ${i + 1} title`}
                className="font-medium"
              />
              <div className="ml-auto flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => move(i, -1)}
                  disabled={fieldLocked || i === 0 || isOpened(i - 1)}
                  aria-label="Move up"
                  className="w-8 px-0"
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => move(i, 1)}
                  disabled={fieldLocked || i === phases.length - 1}
                  aria-label="Move down"
                  className="w-8 px-0"
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(p.id)}
                  disabled={fieldLocked || phases.length === 1}
                  aria-label="Delete phase"
                  className="w-8 px-0 text-base"
                >
                  ×
                </Button>
              </div>
            </div>
            <div className="grid gap-3 pl-8 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={LABEL}>
                Tip (optional)
              </label>
              <Input
                value={p.disciplineHint ?? ""}
                onChange={(e) =>
                  updatePhase(p.id, {
                    disciplineHint: e.target.value || undefined,
                  })
                }
                disabled={fieldLocked}
                className="mt-1.5"
                placeholder="A short tip shown under the prompt"
              />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>
                Student prompt (Markdown)
              </label>
              <Textarea
                value={p.studentPrompt}
                onChange={(e) => updatePhase(p.id, { studentPrompt: e.target.value })}
                disabled={fieldLocked}
                rows={3}
                className="mt-1.5"
              />
            </div>
            <div>
              <label className={LABEL}>
                Suggested time (minutes, optional)
              </label>
              <Input
                type="number"
                min={1}
                max={240}
                value={p.suggestedMinutes ?? ""}
                onChange={(e) =>
                  updatePhase(p.id, {
                    suggestedMinutes: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
                disabled={fieldLocked}
                className="mt-1.5 w-32 tabular-nums"
                placeholder="e.g. 15"
              />
            </div>
            <div className="sm:col-span-2">
              <span className={LABEL}>Activities</span>
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
                {(["clarifying_questions", "notes", "answer_attempt"] as ActivityType[]).map((a) => {
                  const on = p.activities.includes(a);
                  return (
                    <label key={a} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleActivity(p.id, a)}
                        disabled={fieldLocked}
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                      {ACTIVITY_LABELS[a]}
                    </label>
                  );
                })}
              </div>
            </div>
            </div>
          </li>
          );
        })}
      </ol>
      <div className="border-t bg-muted/30 px-4 py-3 sm:px-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addPhase}
          disabled={disabled || phases.length >= 10}
        >
          Add phase
        </Button>
      </div>
    </section>
  );
}
