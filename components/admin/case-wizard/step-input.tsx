"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { DISCIPLINE_PACKS, DISCIPLINE_IDS } from "@/lib/disciplines";
import type { DisciplineId, Difficulty } from "@/lib/disciplines/types";
import { CARD, NOTE_FLAG } from "@/components/admin/styles";
import { cn } from "@/lib/utils";
import { disciplineName } from "@/lib/text/display";

const DIFFICULTIES: Difficulty[] = ["novice", "intermediate", "advanced"];

// Matches the limit the create route enforces.
const OBJECTIVE_MAX = 2000;

// One line per level, summarising the difficulty instruction that each
// discipline pack sends to the model.
const DIFFICULTY_NOTES: Record<Difficulty, string> = {
  novice: "One decision and one framework, with most of the information given.",
  intermediate:
    "Two or three considerations interact, and one key piece of information is vague or contested.",
  advanced: "Several frameworks at once, with information that is missing or in conflict.",
};

// One worked example per discipline. It appears as placeholder text and can be
// copied into the fields with "Use example"; nothing is filled in by itself.
const EXAMPLES: Record<
  DisciplineId,
  { objective: string; concepts: string[]; industry: string; role: string }
> = {
  finance: {
    objective: "Apply the dividend discount model to value a regional bank under uncertainty.",
    concepts: [
      "dividend discount model",
      "cost of equity",
      "terminal value",
      "sensitivity analysis",
    ],
    industry: "retail banking, Singapore",
    role: "junior analyst",
  },
  marketing: {
    objective:
      "Decide whether an established brand should reposition to defend its share against a lower-priced entrant.",
    concepts: ["segmentation", "positioning", "price elasticity"],
    industry: "packaged food retail, Singapore",
    role: "assistant brand manager",
  },
  social_work: {
    objective:
      "Weigh a client's autonomy against the duty to protect when planning care for an older adult.",
    concepts: ["strengths-based practice", "risk assessment", "informed consent"],
    industry: "family service centre, Singapore",
    role: "case worker",
  },
};

function Required() {
  return (
    <span className="text-flag" aria-hidden="true">
      {" "}
      *
    </span>
  );
}

function UseExample({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline"
    >
      Use example
    </button>
  );
}

export function StepInput() {
  const router = useRouter();
  const [discipline, setDiscipline] = useState<DisciplineId>("finance");
  const [learningObjective, setLearningObjective] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty>("intermediate");
  const [conceptInput, setConceptInput] = useState("");
  const [concepts, setConcepts] = useState<string[]>([]);
  const [industry, setIndustry] = useState("");
  const [role, setRole] = useState("");
  const [priorKnowledge, setPriorKnowledge] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An error about the learning objective is shown under that field, any other
  // at the foot of the form.
  const [errorAtObjective, setErrorAtObjective] = useState(false);
  const example = EXAMPLES[discipline];

  // The message under the form names the first field that failed. It is cleared
  // as soon as every field it covers is valid, so it does not sit there after
  // the instructor has fixed the field.
  function clearErrorIfValid(objective: string, ind: string, rl: string) {
    if (!error) return;
    if (objective.trim().length >= 10 && ind.trim() !== "" && rl.trim() !== "") {
      setError(null);
    }
  }

  function addConcept() {
    const v = conceptInput.trim();
    if (!v) return;
    if (concepts.includes(v)) {
      setConceptInput("");
      return;
    }
    setConcepts([...concepts, v]);
    setConceptInput("");
  }

  function removeConcept(c: string) {
    setConcepts(concepts.filter((x) => x !== c));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setErrorAtObjective(false);
    if (learningObjective.trim().length < 10) {
      setErrorAtObjective(true);
      setError("The learning objective is too short. Write at least 10 characters.");
      return;
    }
    if (learningObjective.trim().length > OBJECTIVE_MAX) {
      setErrorAtObjective(true);
      setError(
        `The learning objective is ${learningObjective.trim().length} characters long. The limit is ${OBJECTIVE_MAX}.`,
      );
      return;
    }
    if (!industry.trim() || !role.trim()) {
      setError("Practice context and role are required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discipline,
          learningObjective: learningObjective.trim(),
          difficulty,
          mustCoverConcepts: concepts,
          targetLearnerProfile: {
            industry: industry.trim(),
            role: role.trim(),
            // Optional in the form. Left empty, the difficulty level stands in
            // for it.
            priorKnowledge: priorKnowledge.trim() || difficulty,
          },
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/admin/cases/${id}?step=2`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create case.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <details className="max-w-3xl text-sm">
        <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary">
          How a case is built
        </summary>
        <p className="mt-2 text-muted-foreground">
          You write a brief. PersCase retrieves notes from the discipline corpus, and a
          language model drafts the case from them: scenario, questions, model answers,
          rubric and key terms. You can edit or regenerate any section, and nothing
          reaches a student until you approve the case.
        </p>
      </details>
      <p className="text-sm text-muted-foreground">
        Fields marked <span className="text-flag">*</span> are required. PersCase writes
        in English, and briefs in other languages are not supported.
      </p>
      <div className={cn(CARD, "divide-y [&>section]:px-4 [&>section]:py-5 sm:[&>section]:px-6")}>
      <section>
        <fieldset>
          <legend className="text-base font-semibold">Discipline</legend>
          <p className="mt-1 text-sm text-muted-foreground">
            Sets the corpus, the prompt and the default phase sequence.
          </p>
          <div className="mt-3 space-y-2">
            {DISCIPLINE_IDS.map((id) => {
              const pack = DISCIPLINE_PACKS[id];
              return (
                <label
                  key={id}
                  className={cn(
                    "flex cursor-pointer items-baseline gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                    discipline === id ? "border-primary/50 bg-primary/[0.04]" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name="discipline"
                    value={id}
                    checked={discipline === id}
                    onChange={() => setDiscipline(id)}
                    className="translate-y-0.5 accent-[hsl(var(--primary))]"
                  />
                  <span>
                    <span className="font-medium">{disciplineName(pack.label)}.</span>{" "}
                    <span className="text-muted-foreground">{pack.blurb}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="objective" className="block text-base font-semibold">
            Learning objective
            <Required />
          </label>
          <UseExample onClick={() => setLearningObjective(example.objective)} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          What the learner should be able to do after working through the case. Students
          see this text at the top of every phase.
        </p>
        <Textarea
          id="objective"
          value={learningObjective}
          onChange={(e) => {
            setLearningObjective(e.target.value);
            clearErrorIfValid(e.target.value, industry, role);
          }}
          placeholder={`e.g. ${example.objective}`}
          aria-required="true"
          className="mt-2"
          rows={3}
        />
        {error && errorAtObjective ? (
          <p role="alert" className="mt-1 text-sm text-flag">
            {error}
          </p>
        ) : null}
      </section>

      <section>
        <fieldset>
          <legend className="text-base font-semibold">Difficulty</legend>
          <div className="mt-3 space-y-2">
            {DIFFICULTIES.map((d) => (
              <label
                key={d}
                className={cn(
                  "flex cursor-pointer items-baseline gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
                  difficulty === d ? "border-primary/50 bg-primary/[0.04]" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name="difficulty"
                  value={d}
                  checked={difficulty === d}
                  onChange={() => setDifficulty(d)}
                  className="translate-y-0.5 accent-[hsl(var(--primary))]"
                />
                <span>
                  <span className="font-medium capitalize">{d}.</span>{" "}
                  <span className="text-muted-foreground">{DIFFICULTY_NOTES[d]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="concept" className="block text-base font-semibold">
            Must-cover concepts
          </label>
          {/* Replaces the list rather than adding to it, so switching
              discipline and pressing it again does not pile up the concepts of
              two disciplines. */}
          <UseExample onClick={() => setConcepts([...example.concepts])} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Optional. Type a concept and press Enter or Add. Students see this list at the
          top of every phase.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            id="concept"
            value={conceptInput}
            onChange={(e) => setConceptInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addConcept();
              }
            }}
            placeholder={`e.g. ${example.concepts[0]}`}
          />
          <Button type="button" onClick={addConcept} variant="outline">
            Add
          </Button>
        </div>
        {concepts.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {concepts.map((c) => (
              <li
                key={c}
                className="inline-flex items-center gap-2 rounded-full border bg-muted/50 py-1 pl-3 pr-2"
              >
                <span>{c}</span>
                <button
                  type="button"
                  onClick={() => removeConcept(c)}
                  aria-label={`Remove ${c}`}
                  className="rounded-full px-1.5 text-sm text-muted-foreground underline-offset-2 hover:bg-muted-hover hover:text-foreground hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <label className="block text-base font-semibold">Target learner profile</label>
          <UseExample
            onClick={() => {
              setIndustry(example.industry);
              setRole(example.role);
            }}
          />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Gives the case its setting. The learning objective stays the same.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <label htmlFor="industry" className="block text-sm font-medium">
              Industry or practice context
              <Required />
            </label>
            <Input
              id="industry"
              value={industry}
              onChange={(e) => {
                setIndustry(e.target.value);
                clearErrorIfValid(learningObjective, e.target.value, role);
              }}
              placeholder={`e.g. ${example.industry}`}
              aria-required="true"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="role" className="block text-sm font-medium">
              Role
              <Required />
            </label>
            <Input
              id="role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                clearErrorIfValid(learningObjective, industry, e.target.value);
              }}
              placeholder={`e.g. ${example.role}`}
              aria-required="true"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="prior" className="block text-sm font-medium">
              Prior knowledge
            </label>
            <Input
              id="prior"
              value={priorKnowledge}
              onChange={(e) => setPriorKnowledge(e.target.value)}
              placeholder="e.g. one introductory module"
              aria-describedby="prior-note"
              className="mt-1"
            />
            <p id="prior-note" className="mt-1 text-xs text-muted-foreground">
              Optional. Left empty, the difficulty level is used.
            </p>
          </div>
        </div>
      </section>

      </div>

      {error && !errorAtObjective ? (
        <div role="alert" className={NOTE_FLAG}>
          {error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="md" loading={submitting}>
          {submitting ? "Saving the brief…" : "Continue to retrieval"}
        </Button>
      </div>
    </form>
  );
}
