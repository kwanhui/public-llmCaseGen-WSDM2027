"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { CaseMarkdown } from "@/components/case-viewer/case-render";
import { EXAMPLE_CASE_TITLE } from "@/components/admin/status-pill";
import { InlineConfirm } from "@/components/admin/inline-confirm";
import { CASE_SECTIONS } from "@/lib/generation/schema";
import type { CaseContent, CaseSection } from "@/lib/generation/schema";
import type {
  ConceptCoverageReport,
  DifficultySignal,
} from "@/lib/generation/generate-case";
import { CARD, NOTE_FLAG, PILL_FLAG } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

interface Props {
  caseId: string;
  initialContent: CaseContent;
  status: string;
  conceptCoverage: ConceptCoverageReport;
  difficulty: DifficultySignal;
  quantitative: boolean;
  // A standing line shown beside the approval control for disciplines whose
  // drafts can state a legal duty. Comes from the discipline pack.
  approvalReminder?: string;
  // Placeholder for the note box, in this case's own discipline.
  regenerateNoteExample: string;
  // Seeded example case: the API refuses every editing route for it, so the
  // controls are taken away rather than left to fail.
  readOnly?: boolean;
}

const SECTION_META: Record<
  CaseSection,
  { heading: string; description: string }
> = {
  scenario: {
    heading: "Scenario",
    // What the generation prompt asks for. Drafts usually come out shorter, so
    // the line says so instead of reading as a rule the draft has broken.
    description:
      "The model is asked for 350 to 600 words and often writes fewer. Markdown is rendered for students.",
  },
  discussionQuestions: {
    heading: "Discussion questions",
    description:
      "The model is asked for 4 to 6 open-ended questions. Regenerating them rewrites the model answers to match.",
  },
  modelAnswers: {
    heading: "Model answers",
    description: "",
  },
  rubric: {
    heading: "Rubric",
    description: "The model is asked for four weighted criteria, one sentence each.",
  },
};

// A scenario that has been regenerated or edited by hand can leave the sections
// written against it out of step. The editor says so and leaves the decision to
// the instructor rather than regenerating anything by itself. A questions
// regeneration does not raise the questions or answers note, because it
// rewrites the answers along with the questions.
const STALE_NOTE: Partial<Record<CaseSection, string>> = {
  discussionQuestions:
    "The scenario has changed since these questions were written, so they may no longer fit it.",
  modelAnswers:
    "The scenario has changed since these answers were written, so they may no longer fit it.",
  rubric:
    "The scenario has changed since this rubric was written, so it may no longer fit it.",
};

// The sections a scenario change puts in doubt.
const SCENARIO_DEPENDENTS: CaseSection[] = [
  "discussionQuestions",
  "modelAnswers",
  "rubric",
];

type SectionFlags = Partial<Record<CaseSection, boolean>>;

// Both versions of a regenerated section, so the instructor can read either one
// and settle on it. Held in the browser, keyed by case and section, and dropped
// when the case is approved: storing them server-side would need a schema
// change, and a second regeneration to get a version back costs a model call.
interface SectionHistory {
  previous: Partial<CaseContent>;
  regenerated: Partial<CaseContent>;
  showing: "previous" | "regenerated";
}

type HistoryMap = Partial<Record<CaseSection, SectionHistory>>;

interface StoredEditorState {
  history: HistoryMap;
  stale: SectionFlags;
  // Which sections the instructor has edited by hand, so that the warning
  // before a regeneration survives a reload.
  handEdited: SectionFlags;
  // The scenario the questions, answers and rubric were last generated or
  // confirmed against. A saved scenario that differs from it raises the stale
  // notes.
  confirmedScenario: string;
}

function editorStorageKey(caseId: string): string {
  return `perscase.editor.${caseId}`;
}

// The fields a regeneration of each section replaces. Snapshotted before the
// call, so "Restore previous" puts back exactly what the model overwrote.
function pickFields(content: CaseContent, section: CaseSection): Partial<CaseContent> {
  switch (section) {
    case "scenario":
      return { scenario: content.scenario };
    case "discussionQuestions":
      return {
        discussionQuestions: content.discussionQuestions,
        modelAnswers: content.modelAnswers,
      };
    case "modelAnswers":
      return { modelAnswers: content.modelAnswers };
    case "rubric":
      return { rubric: content.rubric };
  }
}

export function StepEditor({
  caseId,
  initialContent,
  status,
  conceptCoverage,
  difficulty,
  quantitative,
  approvalReminder,
  regenerateNoteExample,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [content, setContent] = useState<CaseContent>(initialContent);
  const [savingState, setSavingState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [regeneratingSection, setRegeneratingSection] = useState<CaseSection | null>(null);
  const [openNoteFor, setOpenNoteFor] = useState<CaseSection | null>(null);
  const [note, setNote] = useState("");
  const [regenError, setRegenError] = useState<Partial<Record<CaseSection, string>>>({});
  const [history, setHistory] = useState<HistoryMap>({});
  const [handEdited, setHandEdited] = useState<SectionFlags>({});
  const [unsaved, setUnsaved] = useState<SectionFlags>({});
  const [stale, setStale] = useState<SectionFlags>({});
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  // The flags the approval confirmation lists, or null while it is closed.
  const [approveFlags, setApproveFlags] = useState<string[] | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The scenario the dependent sections were last written against. Set when
  // those sections are regenerated and when a stale note is dismissed.
  const confirmedScenario = useRef(initialContent.scenario);

  const storageKey = editorStorageKey(caseId);

  // The two versions of each regenerated section, the hand-edited flags and the
  // stale notes are read back after mount rather than in the state initialiser:
  // local storage does not exist during server rendering.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<StoredEditorState>;
      if (parsed.history) setHistory(parsed.history);
      if (parsed.stale) setStale(parsed.stale);
      if (parsed.handEdited) setHandEdited(parsed.handEdited);
      if (typeof parsed.confirmedScenario === "string") {
        confirmedScenario.current = parsed.confirmedScenario;
      }
    } catch {
      // A browser that refuses local storage loses the toggle, not the case.
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      const empty =
        Object.keys(history).length === 0 &&
        Object.values(stale).every((v) => !v) &&
        Object.values(handEdited).every((v) => !v);
      if (empty) window.localStorage.removeItem(storageKey);
      else
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            history,
            stale,
            handEdited,
            confirmedScenario: confirmedScenario.current,
          }),
        );
    } catch {
      // ignore
    }
  }, [storageKey, history, stale, handEdited]);

  const persist = useCallback(
    async (next: CaseContent, restoredSection?: CaseSection) => {
      setSavingState("saving");
      try {
        const res = await fetch(`/api/admin/cases/${caseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentJson: next, restoredSection }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSavingState("saved");
        dirty.current = false;
        setUnsaved({});
        // A scenario saved in a different form from the one the other sections
        // were written against puts them in doubt, whether it was regenerated
        // or edited by hand.
        if (next.scenario !== confirmedScenario.current) {
          setStale((s) => {
            const raised = { ...s };
            for (const section of SCENARIO_DEPENDENTS) raised[section] = true;
            return raised;
          });
        }
        // Re-run the server component so the must-cover line reflects the text
        // that was just saved, without the instructor reloading the page.
        router.refresh();
        setTimeout(() => setSavingState("idle"), 1500);
      } catch {
        setSavingState("error");
      }
    },
    [caseId, router],
  );

  function scheduleSave(next: CaseContent, section?: CaseSection) {
    dirty.current = true;
    setContent(next);
    if (section) {
      setHandEdited((f) => ({ ...f, [section]: true }));
      setUnsaved((f) => ({ ...f, [section]: true }));
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 1500);
  }

  // Flush on tab close/navigation to avoid losing the last edit.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  function openRegenerate(section: CaseSection) {
    setOpenNoteFor((current) => (current === section ? null : section));
    setNote("");
    setRegenError((e) => ({ ...e, [section]: undefined }));
  }

  async function regenerate(section: CaseSection) {
    const before = pickFields(content, section);
    setRegeneratingSection(section);
    setRegenError((e) => ({ ...e, [section]: undefined }));
    try {
      // Save any pending hand edit first, so the model regenerates against the
      // text on screen rather than the last autosaved version.
      if (dirty.current) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        await persist(content);
      }
      const trimmed = note.trim();
      const res = await fetch(`/api/admin/cases/${caseId}/regenerate-section`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section,
          editorNote: trimmed === "" ? undefined : trimmed,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          j.message ??
            `The server returned ${res.status}. This section is unchanged.`,
        );
      }
      const { contentJson } = (await res.json()) as { contentJson: CaseContent };
      setContent(contentJson);
      dirty.current = false;
      setHistory((h) => ({
        ...h,
        [section]: {
          previous: before,
          regenerated: pickFields(contentJson, section),
          showing: "regenerated",
        },
      }));
      setHandEdited((f) => ({ ...f, [section]: false }));
      setUnsaved((f) => ({ ...f, [section]: false }));
      if (section === "scenario") {
        setStale((s) => {
          const raised = { ...s };
          for (const dependent of SCENARIO_DEPENDENTS) raised[dependent] = true;
          return raised;
        });
      } else {
        // The section has just been written against the scenario on screen, so
        // it is in step with it again.
        confirmedScenario.current = contentJson.scenario;
        if (section === "discussionQuestions") {
          setStale((s) => ({ ...s, discussionQuestions: false, modelAnswers: false }));
        } else {
          setStale((s) => ({ ...s, [section]: false }));
        }
      }
      // A questions regeneration rewrites the answers with them, so neither
      // note is raised for it.
      setOpenNoteFor(null);
      setNote("");
      setSavingState("saved");
      router.refresh();
      setTimeout(() => setSavingState("idle"), 1500);
    } catch (err) {
      // Deliberately not the save indicator: nothing failed to save, and the
      // page-top indicator is off screen when you are at a section.
      const offline = err instanceof TypeError;
      setRegenError((e) => ({
        ...e,
        [section]: offline
          ? "Regeneration failed: the request did not reach the server. This section is unchanged."
          : err instanceof Error
            ? err.message
            : "Regeneration failed. This section is unchanged.",
      }));
    } finally {
      setRegeneratingSection(null);
    }
  }

  // Switch a regenerated section between the text the model replaced and the
  // text it wrote. Both directions are available until the case is approved.
  async function showVersion(section: CaseSection, which: "previous" | "regenerated") {
    const entry = history[section];
    if (!entry || entry.showing === which) return;
    const next = { ...content, ...entry[which] } as CaseContent;
    setContent(next);
    setHistory((h) => ({ ...h, [section]: { ...entry, showing: which } }));
    // The scenario's regeneration is what raises the two stale notes, so the
    // notes follow which version of the scenario is on screen.
    if (section === "scenario") {
      const raised = which === "regenerated";
      setStale((s) => {
        const flags = { ...s };
        for (const dependent of SCENARIO_DEPENDENTS) flags[dependent] = raised;
        return flags;
      });
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await persist(next, which === "previous" ? section : undefined);
  }

  function approvalFlags(): string[] {
    const flags: string[] = [];
    if (conceptCoverage.missing.length > 0) {
      flags.push(
        `Must-cover concepts missing: ${conceptCoverage.missing.join(", ")}`,
      );
    }
    // A regeneration that returns unequal counts is refused, but a hand edit
    // can still add a question without an answer, and the draft on screen is
    // what approval locks.
    if (content.discussionQuestions.length !== content.modelAnswers.length) {
      flags.push(
        `${content.discussionQuestions.length} discussion questions and ${content.modelAnswers.length} model answers, so they no longer pair one to one`,
      );
    }
    // The sections written against an earlier scenario. A scenario edit that
    // has not been saved yet counts too, since approval saves it first.
    const scenarioPending = content.scenario !== confirmedScenario.current;
    const staleSections = CASE_SECTIONS.filter(
      (s) => STALE_NOTE[s] && (stale[s] || scenarioPending),
    );
    if (staleSections.length > 0) {
      const names = staleSections.map((s) => SECTION_META[s].heading.toLowerCase());
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      flags.push(
        `The ${list} ${names.length === 1 ? "was" : "were"} written before your last scenario edit, so ${
          names.length === 1 ? "it" : "they"
        } may no longer fit it`,
      );
    }
    if (difficulty.band !== "as-requested") {
      flags.push(`Difficulty signal: ${difficulty.note}`);
    }
    return flags;
  }

  async function approve() {
    setApproveErr(null);
    setApproving(true);
    try {
      // Flush any pending edit first.
      if (dirty.current) await persist(content);
      const res = await fetch(`/api/admin/cases/${caseId}/approve`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
      }
      // The section versions and the stale notes belong to an editable case.
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore
      }
      setApproveFlags(null);
      router.refresh();
      router.push(`/admin/cases/${caseId}`);
    } catch (err) {
      setApproveErr(err instanceof Error ? err.message : "Approve failed.");
      setApproving(false);
    }
  }

  const isApproved = status === "approved" || status === "released";
  const locked = isApproved || readOnly;

  function sectionProps(section: CaseSection) {
    return {
      section,
      regenerate: () => regenerate(section),
      openRegenerate: () => openRegenerate(section),
      noteOpen: openNoteFor === section,
      note,
      onNoteChange: setNote,
      regenerating: regeneratingSection === section,
      error: regenError[section] ?? null,
      handEdited: handEdited[section] ?? false,
      unsaved: unsaved[section] ?? false,
      showing: history[section]?.showing ?? null,
      showVersion: (which: "previous" | "regenerated") => showVersion(section, which),
      staleNote: stale[section] ? (STALE_NOTE[section] ?? null) : null,
      dismissStale: () => {
        // Dismissing is the instructor saying this section fits the scenario as
        // it now stands, so the next change is measured from here.
        confirmedScenario.current = content.scenario;
        setStale((s) => ({ ...s, [section]: false }));
      },
      noteExample: regenerateNoteExample,
      disabled: locked,
      disabledTitle: readOnly ? EXAMPLE_CASE_TITLE : undefined,
    };
  }

  return (
    <div className="space-y-5">
      {/* Once the case is approved nothing here can change, so the row (the
          save state and Approve) goes; the status is the pill in the page header. */}
      {!locked ? (
      <div className="flex items-center justify-between gap-3">
        <SaveIndicator state={savingState} />
        {!isApproved ? (
          // A disabled Button takes no pointer events, so the title sits on a span.
          <span title={readOnly ? EXAMPLE_CASE_TITLE : undefined}>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setApproveErr(null);
                setApproveFlags(approvalFlags());
              }}
              loading={approving}
              disabled={approving || readOnly || approveFlags !== null}
              aria-expanded={approveFlags !== null}
            >
              {approving ? "Approving..." : "Approve"}
            </Button>
          </span>
        ) : null}
      </div>
      ) : null}

      {approveFlags !== null && !locked ? (
        <InlineConfirm
          title="Approve this case?"
          action="Approve"
          busy={approving}
          onCancel={() => setApproveFlags(null)}
          onConfirm={approve}
        >
          {approveFlags.length > 0 ? (
            <>
              <p className="font-medium text-flag">Still flagged:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-flag">
                {approveFlags.map((f) => (
                  <li key={f}>{f}.</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Nothing is flagged.</p>
          )}
          <p>Approving locks the brief and the text and lets you generate team variants.</p>
        </InlineConfirm>
      ) : null}

      {approvalReminder && !locked ? (
        <p className="rounded-lg border border-primary/20 bg-primary/[0.05] px-4 py-2.5 text-sm text-foreground">
          {approvalReminder}
        </p>
      ) : null}

      <MustCoverLine coverage={conceptCoverage} />

      {conceptCoverage.missing.length > 0 ? (
        <p role="alert" className={NOTE_FLAG}>
          <strong>Missing:</strong> {conceptCoverage.missing.join(", ")}.
          {locked
            ? null
            : " Write them in, or regenerate the scenario or the questions; the model is given the missing concepts."}
        </p>
      ) : null}

      <p
        className={
          difficulty.band === "as-requested"
            ? "text-sm text-muted-foreground"
            : "text-sm text-flag"
        }
      >
        <span className="font-medium">Difficulty signal:</span> {difficulty.note} (
        {difficulty.scenarioWords} words, {difficulty.numericTokens} number
        {difficulty.numericTokens === 1 ? "" : "s"}, {difficulty.questionCount} question
        {difficulty.questionCount === 1 ? "" : "s"}). Not a validated measure.
        {quantitative && difficulty.numericTokens > 0
          ? " PersCase does not verify arithmetic, so check that the figures reconcile before you approve."
          : null}
      </p>

      {approveErr ? (
        <div role="alert" className={NOTE_FLAG}>
          {approveErr}
        </div>
      ) : null}

      <SectionEditor
        {...sectionProps("scenario")}
        value={content.scenario}
        onChange={(v) => scheduleSave({ ...content, scenario: v }, "scenario")}
      />

      <SectionListEditor
        {...sectionProps("discussionQuestions")}
        items={content.discussionQuestions}
        onChange={(items) =>
          scheduleSave({ ...content, discussionQuestions: items }, "discussionQuestions")
        }
      />

      <SectionListEditor
        {...sectionProps("modelAnswers")}
        items={content.modelAnswers}
        onChange={(items) =>
          scheduleSave({ ...content, modelAnswers: items }, "modelAnswers")
        }
      />

      <SectionEditor
        {...sectionProps("rubric")}
        value={content.rubric}
        onChange={(v) => scheduleSave({ ...content, rubric: v }, "rubric")}
      />

      <GlossaryEditor
        entries={content.glossary ?? []}
        onChange={(entries) =>
          scheduleSave({ ...content, glossary: entries.length > 0 ? entries : undefined })
        }
        disabled={locked}
      />
    </div>
  );
}

// Shown whether the check passes or fails: one line, with the per-concept
// detail behind it.
function MustCoverLine({ coverage }: { coverage: ConceptCoverageReport }) {
  const total = coverage.covered.length + coverage.missing.length;
  if (total === 0) return null;
  const rows = coverage.concepts;
  return (
    // Open by default: the matched phrase beside each concept is the safeguard
    // against a match that has nothing to do with the concept, and a reader who
    // has to click for it will not see it.
    <details open className={cn(CARD, "px-4 py-3 text-sm sm:px-5")}>
      <summary className="cursor-pointer select-none rounded-sm">
        <span className="font-semibold">Must-cover concepts present:</span>{" "}
        <span className="tabular-nums">
          {coverage.covered.length}/{total}
        </span>
        .{" "}
        <span className="text-muted-foreground">
          Checked: {coverage.sectionsChecked.join(", ")}.
        </span>
      </summary>
      <ul className="mt-3 divide-y border-y">
        {rows.map((r) => (
          <li key={r.concept} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
            <span className="shrink-0 font-medium text-foreground sm:w-56">{r.concept}</span>
            {r.parts.length > 0 ? (
              <span className="text-muted-foreground">
                {r.parts.map((p, i) => (
                  <span key={p.part}>
                    {i > 0 ? " · " : null}
                    {p.part}:{" "}
                    {p.matchedPhrase ? (
                      `present as “${p.matchedPhrase}”`
                    ) : (
                      <span className={PILL_FLAG}>missing</span>
                    )}
                  </span>
                ))}
              </span>
            ) : r.matchedPhrase ? (
              <span className="text-muted-foreground">
                present as “{r.matchedPhrase}”
              </span>
            ) : (
              <span className={PILL_FLAG}>missing</span>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground">
        A concept is present when its words appear close together inside one sentence (a
        word match, not a reading of meaning), with a tension (X vs Y) split into its two
        halves; a concept covered in other words, or named only in the rubric or the key
        terms, reads as missing.
      </p>
    </details>
  );
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  const map: Record<typeof state, { label: string; color: string }> = {
    idle: { label: "All changes saved", color: "text-muted-foreground" },
    saving: { label: "Saving…", color: "text-muted-foreground" },
    saved: { label: "Saved", color: "text-primary" },
    error: { label: "Save failed. The next edit will try again.", color: "text-flag" },
  };
  const { label, color } = map[state];
  return (
    <span className={`text-sm ${color}`} aria-live="polite">
      {label}
    </span>
  );
}

interface SectionShellProps {
  section: CaseSection;
  description: string;
  regenerate: () => void;
  openRegenerate: () => void;
  noteOpen: boolean;
  note: string;
  onNoteChange: (v: string) => void;
  regenerating: boolean;
  error: string | null;
  handEdited: boolean;
  unsaved: boolean;
  // Which of the two versions of a regenerated section is on screen, or null
  // when the section has not been regenerated in this case.
  showing: "previous" | "regenerated" | null;
  showVersion: (which: "previous" | "regenerated") => void;
  staleNote: string | null;
  dismissStale: () => void;
  // Placeholder for the note box, in this case's discipline.
  noteExample: string;
  disabled: boolean;
  // Why the controls are disabled, when the reason is not plain from the page.
  disabledTitle?: string;
  children: React.ReactNode;
}

// The header, the regeneration row and the section-level messages, shared by the
// free-text and list editors.
function SectionShell({
  section,
  description,
  regenerate,
  openRegenerate,
  noteOpen,
  note,
  onNoteChange,
  regenerating,
  error,
  handEdited,
  unsaved,
  showing,
  showVersion,
  staleNote,
  dismissStale,
  noteExample,
  disabled,
  disabledTitle,
  children,
}: SectionShellProps) {
  const meta = SECTION_META[section];
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{meta.heading}</h3>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showing ? (
            <span className="text-sm text-muted-foreground">
              {showing === "previous" ? "Showing the previous text" : "Showing the regenerated text"}
            </span>
          ) : null}
          {showing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                showVersion(showing === "regenerated" ? "previous" : "regenerated")
              }
              disabled={disabled || regenerating}
            >
              {showing === "regenerated" ? "Show previous" : "Show regenerated"}
            </Button>
          ) : null}
          <span title={disabledTitle}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openRegenerate}
              disabled={disabled || regenerating}
              aria-expanded={noteOpen}
            >
              Regenerate
            </Button>
          </span>
        </div>
      </header>

      {noteOpen ? (
        <div className="border-b bg-muted/50 px-4 py-3 sm:px-5">
          <label
            htmlFor={`note-${section}`}
            className="block text-sm font-medium text-foreground"
          >
            Note to the model (optional)
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              id={`note-${section}`}
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder={`One line, for example: ${noteExample}`}
              disabled={regenerating}
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              onClick={regenerate}
              loading={regenerating}
              disabled={regenerating}
            >
              Regenerate section
            </Button>
          </div>
          {section === "discussionQuestions" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              The model answers are rewritten with the questions, so that each answer still
              answers its question. Both come back together, and “Show previous” puts both
              back.
            </p>
          ) : null}
          {handEdited || unsaved ? (
            <p className="mt-2 text-sm text-flag">
              {unsaved
                ? "You have edited this section and the edit is not saved yet. It is saved first, then replaced by the new text."
                : "You have edited this section by hand. Regenerating replaces that text."}{" "}
              You can put it back with “Show previous” afterwards.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="border-b border-flag/30 bg-flag/5 px-4 py-2 text-sm text-flag sm:px-5"
        >
          {error}{" "}
          <button
            type="button"
            onClick={regenerate}
            className="font-medium underline underline-offset-2"
          >
            Retry
          </button>
        </p>
      ) : null}

      {staleNote ? (
        <p className="flex items-baseline justify-between gap-3 border-b border-flag/30 bg-flag/5 px-4 py-2 text-sm text-flag sm:px-5">
          <span>{staleNote}</span>
          <button
            type="button"
            onClick={dismissStale}
            className="shrink-0 font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {children}
    </section>
  );
}

function SectionEditor({
  value,
  onChange,
  ...shell
}: Omit<SectionShellProps, "children" | "description"> & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <SectionShell {...shell} description={SECTION_META[shell.section].description}>
      {shell.disabled ? (
        // A locked case is read, not edited, so the markdown is rendered.
        <div className="px-4 py-4 sm:px-5">
          <CaseMarkdown className="[&_p]:whitespace-pre-line">{value}</CaseMarkdown>
        </div>
      ) : (
        <Textarea
          className="min-h-[160px] resize-y rounded-none border-0 bg-transparent px-4 py-3 text-base leading-relaxed shadow-none focus-visible:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0 sm:px-5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={shell.regenerating}
        />
      )}
    </SectionShell>
  );
}

function SectionListEditor({
  items,
  onChange,
  ...shell
}: Omit<SectionShellProps, "children" | "description"> & {
  items: string[];
  onChange: (items: string[]) => void;
}) {
  // While the answers are flagged as possibly stale, the "Matched 1:1" caption
  // would be a claim the editor cannot make.
  const description =
    shell.section === "modelAnswers" && shell.staleNote
      ? "Not checked against the current questions."
      : SECTION_META[shell.section].description;
  return (
    <SectionShell {...shell} description={description}>
      <ol className="divide-y">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-3 sm:px-5">
            <span className="mt-0.5 shrink-0 text-sm tabular-nums text-muted-foreground">{i + 1}.</span>
            {shell.disabled ? (
              <CaseMarkdown className="mt-1 min-w-0 flex-1 [&_p]:whitespace-pre-line">
                {item}
              </CaseMarkdown>
            ) : (
              <Textarea
                className="min-h-[60px] resize-y rounded-sm border-0 bg-transparent p-0 text-base leading-relaxed shadow-none focus-visible:bg-muted/30 focus-visible:ring-0 focus-visible:ring-offset-0"
                value={item}
                onChange={(e) => {
                  const next = items.slice();
                  next[i] = e.target.value;
                  onChange(next);
                }}
                disabled={shell.regenerating}
              />
            )}
          </li>
        ))}
      </ol>
    </SectionShell>
  );
}

// The glossary the student page shows under "Key terms". It is generated with
// the case, so it needs to be editable here before the case is approved.
function GlossaryEditor({
  entries,
  onChange,
  disabled,
}: {
  entries: { term: string; definition: string }[];
  onChange: (entries: { term: string; definition: string }[]) => void;
  disabled: boolean;
}) {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Key terms</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Shown to students as a glossary. Up to 10 terms.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || entries.length >= 10}
          onClick={() => onChange([...entries, { term: "", definition: "" }])}
        >
          Add a term
        </Button>
      </header>
      {entries.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">
          No key terms. Students see no glossary for this case.
        </p>
      ) : (
        <ul className="divide-y">
          {entries.map((entry, i) => (
            <li key={i} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap sm:px-5">
              <Input
                aria-label={`Term ${i + 1}`}
                className="w-full shrink-0 sm:w-56"
                value={entry.term}
                placeholder="Term"
                maxLength={80}
                disabled={disabled}
                onChange={(e) => {
                  const next = entries.slice();
                  next[i] = { ...next[i], term: e.target.value };
                  onChange(next);
                }}
              />
              <Textarea
                aria-label={`Definition ${i + 1}`}
                className="min-h-[36px] resize-y"
                value={entry.definition}
                placeholder="One plain-language sentence"
                maxLength={400}
                disabled={disabled}
                onChange={(e) => {
                  const next = entries.slice();
                  next[i] = { ...next[i], definition: e.target.value };
                  onChange(next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => onChange(entries.filter((_, k) => k !== i))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
