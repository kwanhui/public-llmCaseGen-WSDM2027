"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import type { Difficulty } from "@/lib/disciplines/types";
import { buttonClass } from "@/components/ui/button";
import { CARD, LABEL } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

const DIFFICULTIES: Difficulty[] = ["novice", "intermediate", "advanced"];

interface Brief {
  learningObjective: string;
  difficulty: Difficulty;
  mustCoverConcepts: string[];
  targetLearnerProfile: { industry: string; role: string; priorKnowledge: string };
}

// Lets the instructor iterate on the case brief before approval, then
// regenerate the whole case from it, instead of starting a new wizard. The
// brief is locked once the case is approved.
export function EditBriefForm({ caseId, initial }: { caseId: string; initial: Brief }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [objective, setObjective] = useState(initial.learningObjective);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [concepts, setConcepts] = useState(initial.mustCoverConcepts.join(", "));
  const [industry, setIndustry] = useState(initial.targetLearnerProfile.industry);
  const [role, setRole] = useState(initial.targetLearnerProfile.role);
  const [prior, setPrior] = useState(initial.targetLearnerProfile.priorKnowledge);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spec: {
            learningObjective: objective.trim(),
            difficulty,
            mustCoverConcepts: concepts
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
            targetLearnerProfile: {
              industry: industry.trim(),
              role: role.trim(),
              priorKnowledge: prior.trim(),
            },
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the brief.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass("outline", "sm")}
      >
        Edit the brief and regenerate
      </button>
    );
  }

  return (
    <div className={cn(CARD, "space-y-4 px-4 py-4 sm:px-5 sm:py-5")}>
      <p className="text-sm text-muted-foreground">
        Saving the brief does not change the draft. Regenerate the case to apply it.
      </p>
      <div>
        <label htmlFor="eb-obj" className={LABEL}>
          Learning objective
        </label>
        <Textarea
          id="eb-obj"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={2}
          className="mt-1.5"
        />
      </div>
      <div className="flex flex-wrap gap-4">
        <div>
          <span className={LABEL}>Difficulty</span>
          <div className="mt-1.5 inline-flex rounded-full bg-muted p-1">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDifficulty(d)}
                className={cn(
                  "h-7 rounded-full px-3 text-sm font-medium capitalize transition-colors",
                  difficulty === d
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted-hover hover:text-foreground",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div>
        <label htmlFor="eb-concepts" className={LABEL}>
          Must-cover concepts (comma-separated)
        </label>
        <Input
          id="eb-concepts"
          value={concepts}
          onChange={(e) => setConcepts(e.target.value)}
          className="mt-1.5"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="eb-industry" className={LABEL}>
            Industry
          </label>
          <Input id="eb-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <label htmlFor="eb-role" className={LABEL}>
            Role
          </label>
          <Input id="eb-role" value={role} onChange={(e) => setRole(e.target.value)} className="mt-1.5" />
        </div>
        <div>
          <label htmlFor="eb-prior" className={LABEL}>
            Prior knowledge
          </label>
          <Input id="eb-prior" value={prior} onChange={(e) => setPrior(e.target.value)} className="mt-1.5" />
        </div>
      </div>
      {err ? <p className="text-sm text-flag">{err}</p> : null}
      {saved && !err ? (
        <p className="text-sm text-primary">
          Brief saved. Go to Generation to regenerate the case from it.
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" variant="primary" size="sm" onClick={save} loading={saving} disabled={saving}>
          Save brief
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </div>
  );
}
