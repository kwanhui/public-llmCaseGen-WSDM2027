"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CaseMarkdown } from "@/components/case-viewer/case-render";
import { formatDateTime } from "@/lib/format-date";
import type { ConceptCoverageReport } from "@/lib/generation/generate-case";
import { compareScenario, stripLeadingScenarioHeading } from "@/lib/text/diff-sentences";
import { CARD } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

interface VariantPreview {
  scenario: string;
  discussionQuestions: string[];
  modelAnswers: string[];
  rubric: string;
  glossary: { term: string; definition: string }[];
}

interface VariantRow {
  id: string;
  token: string;
  learnerProfile: {
    displayName?: string | null;
    industry: string;
    role: string;
    // The master case's value. It is not set per team.
    priorKnowledge: string;
    teamSize?: number;
  };
  coverage: ConceptCoverageReport;
  preview: VariantPreview | null;
  viewCount: number;
  firstViewedAt: string | null;
  lastViewedAt: string | null;
  responseSummary: {
    phaseId: string;
    activityType: string;
    chars: number;
    text: string;
    updatedAt?: string | null;
  }[];
}

const ACTIVITY_LABEL: Record<string, string> = {
  clarifying_questions: "Clarifying questions",
  notes: "Notes",
  answer_attempt: "Answer",
};

interface Assessment {
  criteria: { criterion: string; judgment: string }[];
  overall: string;
  band: string;
  safetyNote?: string;
  disclosureNote?: string;
}

interface Props {
  variants: VariantRow[];
  origin: string;
  caseId: string;
  // Phase id to the title students see, so submissions are headed by the task
  // rather than by an internal id.
  phaseTitles: Record<string, string>;
  // The approved master's scenario, used for the sentence-level comparison
  // shown on each card and above each open preview.
  masterScenario: string;
  // Placeholder for the redraft note box, in this case's discipline.
  redraftNoteExample: string;
  // Seeded example case: regenerating a team case is refused server-side.
  readOnly?: boolean;
  // Released: students may already be reading a team's text.
  released?: boolean;
  // The case's own industry (its setting), to tell when a team's differs.
  caseIndustry?: string;
}

// Markdown emphasis inside one sentence of the change view. That view marks
// sentences one by one, so it cannot hand whole paragraphs to the Markdown
// renderer; this covers the markers the drafts use.
function renderInline(raw: string): ReactNode[] {
  // An emphasis run can start in one sentence and close in the next, which
  // leaves this sentence holding one marker of a pair. Close it at the edge the
  // run continues past, so the marker is never printed.
  let text = raw;
  for (const marker of ["**", "__"]) {
    const count = text.split(marker).length - 1;
    if (count % 2 === 1) {
      text = text.endsWith(marker) ? marker + text : text + marker;
    }
  }
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.length > 4 && (part.startsWith("**") || part.startsWith("__")))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && (part.startsWith("*") || part.startsWith("_")))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.length > 2 && part.startsWith("`"))
      return <code key={i}>{part.slice(1, -1)}</code>;
    return <span key={i}>{part}</span>;
  });
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportLinksCsv(variants: VariantRow[], origin: string) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  // The first four columns match the CSV the spawn form reads back.
  const header = "teamName,industry,role,teamSize,url";
  const rows = variants.map((v) => {
    const lp = v.learnerProfile;
    return [
      esc(lp.displayName ?? ""),
      esc(lp.industry),
      esc(lp.role),
      esc(lp.teamSize ? String(lp.teamSize) : ""),
      esc(`${origin}/case/${v.token}`),
    ].join(",");
  });
  downloadCsv([header, ...rows].join("\n"), "perscase-team-links.csv");
}

// A grading-friendly export of the teams' submitted work: one row per saved
// response, keyed to a human-readable team name rather than an internal id.
// This hands the instructor the text to grade in their own system; PersCase
// itself does not assign a grade of record.
function exportSubmissionsCsv(variants: VariantRow[], caseId: string) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = "caseId,teamName,industry,role,phaseId,activityType,lastSavedAt,response";
  const rows: string[] = [];
  for (const v of variants) {
    const lp = v.learnerProfile;
    const teamName = lp.displayName || `${lp.industry} / ${lp.role}`;
    for (const r of v.responseSummary) {
      if (!r.text.trim()) continue;
      rows.push(
        [
          esc(caseId),
          esc(teamName),
          esc(lp.industry),
          esc(lp.role),
          esc(r.phaseId),
          esc(ACTIVITY_LABEL[r.activityType] ?? r.activityType),
          esc(r.updatedAt ?? ""),
          esc(r.text),
        ].join(","),
      );
    }
  }
  downloadCsv([header, ...rows].join("\n"), "perscase-answers.csv");
}

// The team links as plain lines, "Team name: link", ready to paste into a
// message to the class.
function teamLinksText(variants: VariantRow[], origin: string): string {
  return variants.map((v) => `${teamName(v)}: ${origin}/case/${v.token}`).join("\n");
}

// Industries compared after case and spacing, so "Retail banking" and
// "retail  banking" are one setting. One that contains the other also counts
// as the same, so "air freight forwarding" matches a case set in "freight
// forwarding".
function sameSetting(a: string, b: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

function teamName(v: VariantRow): string {
  return (
    v.learnerProfile.displayName ??
    `${v.learnerProfile.role} · ${v.learnerProfile.industry}`
  );
}

export function VariantList({
  variants,
  origin,
  caseId,
  masterScenario,
  phaseTitles,
  redraftNoteExample,
  readOnly = false,
  released = false,
  caseIndustry = "",
}: Props) {
  const [openPreviews, setOpenPreviews] = useState<string[]>([]);
  const [linksCopied, setLinksCopied] = useState(false);

  async function copyLinks() {
    try {
      await navigator.clipboard.writeText(teamLinksText(variants, origin));
      setLinksCopied(true);
      setTimeout(() => setLinksCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  function togglePreview(id: string) {
    setOpenPreviews((open) =>
      open.includes(id) ? open.filter((x) => x !== id) : [...open, id],
    );
  }

  if (variants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        No team variants yet.
      </div>
    );
  }

  const open = variants.filter((v) => openPreviews.includes(v.id) && v.preview);
  const noAnswers = variants.every((v) => v.responseSummary.every((r) => !r.text.trim()));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium tabular-nums text-muted-foreground">
          {variants.length} team{variants.length === 1 ? "" : "s"}
        </span>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {noAnswers ? (
            <span id="export-answers-reason" className="text-sm text-muted-foreground">
              No answers saved yet.
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => exportSubmissionsCsv(variants, caseId)}
            disabled={noAnswers}
            aria-describedby={noAnswers ? "export-answers-reason" : undefined}
            title="Each team's saved work, one row per entry"
          >
            Export answers (CSV)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => exportLinksCsv(variants, origin)}
          >
            Export links (CSV)
          </Button>
          {/* With the variants generated, sending the links is the next action. */}
          <Button type="button" variant="primary" size="sm" onClick={copyLinks}>
            {linksCopied ? "Copied" : "Copy team links"}
          </Button>
        </div>
      </div>
      <ul className="space-y-3">
        {variants.map((v) => (
          <li key={v.id} className={cn(CARD, "px-4 py-4 sm:px-5")}>
            <VariantRowView
              v={v}
              origin={origin}
              caseId={caseId}
              phaseTitles={phaseTitles}
              masterScenario={masterScenario}
              redraftNoteExample={redraftNoteExample}
              previewOpen={openPreviews.includes(v.id)}
              togglePreview={() => togglePreview(v.id)}
              readOnly={readOnly}
              released={released}
              caseIndustry={caseIndustry}
            />
          </li>
        ))}
      </ul>
      {open.length > 0 ? (
        // Open previews sit outside the list. A single preview takes the full
        // width; from two on they sit two to a row on a wide screen, so two
        // teams' cases can be compared side by side.
        <div className={open.length === 1 ? "grid gap-4" : "grid gap-4 xl:grid-cols-2"}>
          {open.map((v) => (
            <PreviewPanel
              key={v.id}
              name={teamName(v)}
              preview={v.preview as VariantPreview}
              masterScenario={masterScenario}
              onClose={() => togglePreview(v.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function VariantRowView({
  v,
  origin,
  caseId,
  phaseTitles,
  masterScenario,
  redraftNoteExample,
  previewOpen,
  togglePreview,
  readOnly,
  released,
  caseIndustry,
}: {
  v: VariantRow;
  origin: string;
  caseId: string;
  phaseTitles: Record<string, string>;
  masterScenario: string;
  redraftNoteExample: string;
  readOnly: boolean;
  released: boolean;
  caseIndustry: string;
  previewOpen: boolean;
  togglePreview: () => void;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [regenMessage, setRegenMessage] = useState<string | null>(null);
  const [redraftOpen, setRedraftOpen] = useState(false);
  const [redraftNote, setRedraftNote] = useState("");
  const hasAttempt = v.responseSummary.some((r) => r.activityType === "answer_attempt");
  const url = `${origin}/case/${v.token}`;
  const total = v.coverage.covered.length + v.coverage.missing.length;
  // Shown on the card, so the instructor sees how far a variant has drifted
  // without opening the preview.
  const drift = useMemo(
    () => (v.preview ? compareScenario(masterScenario, v.preview.scenario) : null),
    [masterScenario, v.preview],
  );
  const mostChanged = drift !== null && drift.total > 0 && drift.changed * 2 > drift.total;
  // A team set in another industry whose variant barely moved: the model kept
  // the case's setting (usually because the objective names it) and changed
  // only the reader's role.
  const settingKept =
    drift !== null &&
    caseIndustry.trim() !== "" &&
    v.learnerProfile.industry.trim() !== "" &&
    !sameSetting(v.learnerProfile.industry, caseIndustry) &&
    drift.changed < 3;

  async function assess() {
    setAssessing(true);
    setAssessError(null);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/assess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: v.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setAssessment(data.assessment as Assessment);
    } catch (e) {
      setAssessError(e instanceof Error ? e.message : "Assessment failed");
    } finally {
      setAssessing(false);
    }
  }

  // Redraft this team's case from the approved master, keeping the team's
  // profile and its existing link.
  async function regenerate() {
    const note = redraftNote.trim();
    setRegenerating(true);
    setRegenMessage(null);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          regenerateVariantId: v.id,
          editorNote: note === "" ? undefined : note,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const result = (data.results ?? [])[0] as
        | {
            status: string;
            message?: string;
            conceptsMissing?: string[];
            unchanged?: boolean;
          }
        | undefined;
      if (!result || result.status !== "created") {
        setRegenMessage(result?.message ?? "Regeneration failed. This team's variant is unchanged.");
        return;
      }
      // The model can return the text it was given, word for word, even with
      // a note asking for a change. Say so rather than report a redraft.
      setRegenMessage(
        result.unchanged
          ? "The redraft returned the same text; nothing changed."
          : result.conceptsMissing && result.conceptsMissing.length > 0
          ? `Redrafted. Still missing: ${result.conceptsMissing.join(", ")}.`
          : "Redrafted. All must-cover concepts present.",
      );
      setRedraftOpen(false);
      setRedraftNote("");
      router.refresh();
    } catch (e) {
      setRegenMessage(
        e instanceof Error ? e.message : "Regeneration failed. This team's variant is unchanged.",
      );
    } finally {
      setRegenerating(false);
    }
  }

  const teamSize = v.learnerProfile.teamSize;
  const name = teamName(v);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  const totalChars = v.responseSummary.reduce((acc, r) => acc + r.chars, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-base font-semibold">
            {name}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {v.learnerProfile.industry} · {v.learnerProfile.role}
            {teamSize ? ` · ${teamSize} students` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground">
          <span>{v.viewCount} views</span>
          {v.lastViewedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>last opened {formatDateTime(v.lastViewedAt)}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border bg-muted/50 px-2.5 font-mono text-xs">
          {url}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {total === 0 ? (
          <span className="text-muted-foreground">No must-cover concepts set.</span>
        ) : v.coverage.missing.length === 0 ? (
          <span className="tabular-nums text-foreground">
            Must-cover concepts present: {v.coverage.covered.length}/{total}
          </span>
        ) : (
          <span className="tabular-nums text-flag">
            Must-cover concepts present: {v.coverage.covered.length}/{total}. Missing:{" "}
            {v.coverage.missing.join(", ")}.
          </span>
        )}
        {drift ? (
          drift.changed === 0 ? (
            <span className="text-flag">Scenario identical to the case</span>
          ) : (
            <span className={cn("tabular-nums", mostChanged ? "text-flag" : "text-muted-foreground")}>
              {drift.changed} of {drift.total} scenario sentence
              {drift.total === 1 ? "" : "s"} differ from the case
            </span>
          )
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setRedraftOpen((open) => !open);
            setRegenMessage(null);
          }}
          disabled={regenerating || readOnly}
          aria-expanded={redraftOpen}
        >
          Regenerate this variant
        </Button>
        {mostChanged ? (
          <span className="text-flag">
            Most of this team variant differs from the case; read it before use.
          </span>
        ) : null}
        {settingKept ? (
          <span className="text-flag">
            This team works in {v.learnerProfile.industry.trim()}; the case is set in{" "}
            {caseIndustry.trim()}. The variant keeps the case&apos;s setting and changes the
            reader&apos;s role, because the objective names the setting.
          </span>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={togglePreview}>
          {previewOpen ? "Hide preview" : "Preview this variant"}
        </Button>
      </div>
      {redraftOpen ? (
        <div className="rounded-md border bg-muted/50 px-3 py-3 sm:px-4">
          <label
            htmlFor={`redraft-note-${v.id}`}
            className="block text-sm font-medium text-foreground"
          >
            Note to the model (optional)
          </label>
          <Input
            id={`redraft-note-${v.id}`}
            value={redraftNote}
            onChange={(e) => setRedraftNote(e.target.value)}
            placeholder={`For example: ${redraftNoteExample}`}
            disabled={regenerating}
            className="mt-1.5"
          />
          <p className="mt-2 text-sm text-flag">
            {released ? "Students may already have opened this link. " : null}
            This replaces {name}&apos;s current case. The team keeps the same link, and
            the text it has now is not kept.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={regenerate}
              loading={regenerating}
              disabled={regenerating}
            >
              Replace this variant
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRedraftOpen(false)}
              disabled={regenerating}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {regenMessage ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">{regenMessage}</p>
      ) : null}

      {totalChars > 0 ? (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm font-medium text-primary underline-offset-2 hover:underline">
            Read answers ({v.responseSummary.length}{" "}
            {v.responseSummary.length === 1 ? "entry" : "entries"}, {totalChars} characters)
          </summary>
          <ul className="mt-2 space-y-2">
            {v.responseSummary.map((r, i) => (
              <li key={i} className="rounded-md border bg-muted/40 px-3 py-2">
                <div className="text-xs font-medium text-muted-foreground">
                  {phaseTitles[r.phaseId] ?? r.phaseId} ·{" "}
                  {ACTIVITY_LABEL[r.activityType] ?? r.activityType}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-foreground">{r.text}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {hasAttempt ? (
        <div className="border-t pt-3">
          {assessment ? (
            <div className="rounded-md border bg-muted/40 px-3 py-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">Rubric assessment</span>
                <span className="inline-flex items-center rounded-full bg-muted-hover px-2 py-0.5 text-xs font-medium capitalize">
                  {assessment.band}
                </span>
              </div>
              {assessment.safetyNote?.trim() ? (
                <p className="mt-2 border-l-2 border-flag/60 pl-2 text-flag">
                  {assessment.safetyNote}
                </p>
              ) : null}
              {assessment.disclosureNote?.trim() ? (
                <p className="mt-2 border-l-2 border-primary/40 pl-2">
                  {assessment.disclosureNote}
                </p>
              ) : null}
              <ul className="mt-2 space-y-1">
                {assessment.criteria.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">{c.criterion}:</span>{" "}
                    <span className="text-muted-foreground">{c.judgment}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">{assessment.overall}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generated by the model against the rubric. It is formative and is not a grade.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={assess}
              disabled={assessing || readOnly}
              className="inline-flex h-8 items-center rounded-md border border-input/70 bg-card px-3 text-sm font-semibold shadow-xs transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              {assessing ? "Assessing…" : "Assess answer against rubric"}
            </button>
          )}
          {assessError ? <p className="mt-1 text-sm text-flag">{assessError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// Everything the team receives, including the parts the student page reveals
// later: model answers, rubric and glossary.
function PreviewPanel({
  name,
  preview,
  masterScenario,
  onClose,
}: {
  name: string;
  preview: VariantPreview;
  masterScenario: string;
  onClose: () => void;
}) {
  const [showDiff, setShowDiff] = useState(true);
  const scenario = stripLeadingScenarioHeading(preview.scenario);
  const ref = useRef<HTMLElement>(null);
  const { blocks, flags, changed, total } = useMemo(
    () => compareScenario(masterScenario, preview.scenario),
    [masterScenario, preview.scenario],
  );
  // The panel sits below the list of cards, so opening it can leave the
  // viewport unchanged. Bring it into view on open.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <section ref={ref} className={cn(CARD, "scroll-mt-20 overflow-hidden")}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:px-5">
        <h3 className="text-base font-semibold">{name}</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </header>
      <div className="relative max-h-[70vh] space-y-5 overflow-y-auto px-4 py-4 text-sm sm:px-5">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Scenario</h4>
            <button
              type="button"
              onClick={() => setShowDiff((s) => !s)}
              className="rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              {showDiff ? "Hide what changed" : "Show what changed"}
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {changed === 0
              ? "The scenario is identical to the case. "
              : `${changed} of ${total} ${total === 1 ? "sentence differs" : "sentences differ"} from the case's scenario. `}
            The comparison is sentence by sentence, so a sentence with one word changed
            counts as changed.
          </p>
          {showDiff ? (
            <div className="mt-2 space-y-2 leading-relaxed text-muted-foreground">
              {(() => {
                let n = 0;
                return blocks.map((block, bi) => {
                  const marked = block.sentences.map((s, si) => (
                    <span
                      key={si}
                      className={flags[n++] ? "rounded-sm bg-flag/15 text-foreground" : undefined}
                    >
                      {renderInline(s)}{" "}
                    </span>
                  ));
                  return block.kind === "li" ? (
                    <p key={bi} className="pl-4 -indent-3">
                      · {marked}
                    </p>
                  ) : (
                    <p key={bi}>{marked}</p>
                  );
                });
              })()}
            </div>
          ) : (
            <CaseMarkdown className="mt-1 text-sm text-muted-foreground [&_p]:whitespace-pre-line">
              {scenario}
            </CaseMarkdown>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Discussion questions</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
            {preview.discussionQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Model answers</h4>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
            {preview.modelAnswers.map((a, i) => (
              <li key={i}>
                <CaseMarkdown className="text-sm [&_p]:whitespace-pre-line">{a}</CaseMarkdown>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Rubric</h4>
          <CaseMarkdown className="mt-1 text-sm text-muted-foreground [&_p]:whitespace-pre-line">
            {preview.rubric}
          </CaseMarkdown>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Key terms</h4>
          {preview.glossary.length === 0 ? (
            <p className="mt-1 text-muted-foreground">None.</p>
          ) : (
            <dl className="mt-1 space-y-1 text-muted-foreground">
              {preview.glossary.map((g, i) => (
                <div key={i}>
                  <dt className="inline font-medium text-foreground">{g.term}: </dt>
                  <dd className="inline">{g.definition}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}
