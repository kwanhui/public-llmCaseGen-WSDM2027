"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CaseMarkdown } from "@/components/case-viewer/case-render";
import type { CaseContent } from "@/lib/generation/schema";
import { EXAMPLE_CASE_TITLE } from "@/components/admin/status-pill";
import { CARD, NOTE_FLAG } from "@/components/admin/styles";

interface Props {
  caseId: string;
  hasExistingContent: boolean;
  // Seeded example case: generation is refused for it server-side.
  readOnly?: boolean;
  // Approved or released: the text is locked and generation is refused, and
  // the text is "the case" rather than "the draft".
  approved?: boolean;
}

export function StepGeneration({
  caseId,
  hasExistingContent,
  readOnly = false,
  approved = false,
}: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running" | "done">(
    hasExistingContent ? "done" : "idle",
  );
  const [content, setContent] = useState<CaseContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Tick an elapsed-seconds counter while generating so the wait reads as live
  // progress rather than a frozen screen. The counter is reset in generate();
  // the effect only owns the interval lifecycle.
  useEffect(() => {
    if (phase !== "running") return;
    const handle = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(handle);
  }, [phase]);

  async function generate() {
    setElapsed(0);
    setPhase("running");
    setError(null);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/generate`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      const { contentJson } = (await res.json()) as { contentJson: CaseContent };
      setContent(contentJson);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("idle");
    }
  }

  return (
    <div className="space-y-6">
      {phase === "idle" && (
        <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center">
          <h3 className="text-lg font-semibold">
            {hasExistingContent ? "Regenerate the whole case" : "Generate the draft"}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasExistingContent
              ? "This replaces the current draft, including your edits. It takes 10 to 40 seconds."
              : "This takes 10 to 40 seconds."}
          </p>
          <span className="mt-5 inline-block" title={readOnly ? EXAMPLE_CASE_TITLE : undefined}>
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={generate}
              disabled={readOnly}
            >
              {hasExistingContent ? "Regenerate full case" : "Generate case"}
            </Button>
          </span>
        </div>
      )}

      {phase === "running" && (
        <div className={`${CARD} px-6 py-10 text-center`} aria-live="polite">
          <div className="inline-flex items-center gap-3 text-sm text-muted-foreground">
            <span
              className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden="true"
            />
            Generating the draft. {elapsed}s elapsed (usually 10 to 40s)
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Authoring time is counted from when the brief was saved until you approve the
            case.
          </p>
        </div>
      )}

      {error ? (
        <div
          role="alert"
          className={NOTE_FLAG}
        >
          {error}
        </div>
      ) : null}

      {phase === "done" && content && (
        <div className="space-y-4">
          <p className="text-sm">
            Draft generated. Read it here, then continue to edit and approve it.
          </p>

          <Section heading="Scenario" body={content.scenario} />
          <Section
            heading="Discussion questions"
            body={content.discussionQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n\n")}
          />
          <Section
            heading="Model answers"
            body={content.modelAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n\n")}
          />
          <Section heading="Rubric" body={content.rubric} />

          <div className="flex justify-between border-t pt-4">
            <Button type="button" variant="outline" onClick={generate} disabled={readOnly}>
              Regenerate
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => router.push(`/admin/cases/${caseId}?step=4`)}
            >
              Continue to edit and approve
            </Button>
          </div>
        </div>
      )}

      {phase === "done" && !content && hasExistingContent ? (
        <div className={`${CARD} px-5 py-4 text-sm text-muted-foreground`}>
          {approved
            ? "This case is approved, so its text is locked and cannot be regenerated."
            : readOnly
              ? "This case already has a draft."
              : "This case already has a draft. Regenerating replaces it, including your edits."}
          <div className="mt-4 flex gap-2">
            {approved ? null : (
              // A disabled Button takes no pointer events, so the title sits on a span.
              <span title={readOnly ? EXAMPLE_CASE_TITLE : undefined}>
                <Button type="button" variant="outline" onClick={generate} disabled={readOnly}>
                  Regenerate
                </Button>
              </span>
            )}
            <Button
              type="button"
              variant={readOnly ? "outline" : "primary"}
              onClick={() => router.push(`/admin/cases/${caseId}?step=4`)}
            >
              {approved ? "Continue to the case" : "Continue to edit and approve"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <section className={CARD}>
      <h4 className="border-b px-4 py-2.5 text-sm font-semibold sm:px-5">{heading}</h4>
      <div className="px-4 py-4 sm:px-5">
        <CaseMarkdown className="[&_p]:whitespace-pre-line">{body}</CaseMarkdown>
      </div>
    </section>
  );
}
