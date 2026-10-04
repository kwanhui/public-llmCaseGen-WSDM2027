"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

type Audience = "instructor" | "student";

interface Row {
  aspect: string;
  traditional: string;
  perscase: string;
}

const ROWS: Record<Audience, Row[]> = {
  instructor: [
    {
      aspect: "Where the case comes from",
      traditional: "A published case, or one written from scratch for the course",
      perscase:
        "A draft generated from your brief and up to five discipline notes, which you edit and approve",
    },
    {
      aspect: "Fit to the cohort",
      traditional: "One case for the whole class",
      perscase:
        "A team variant for each team, for the team's role and point of view, with the must-cover concepts checked again",
    },
    {
      aspect: "Must-cover concepts present",
      traditional: "Checked by reading",
      perscase:
        "A must-cover check that matches words, not meaning, on the draft and on every team variant",
    },
    {
      aspect: "Seeing what shaped the text",
      traditional: "Not visible",
      perscase:
        "The retrieved notes, the contrastive view against a plain prompt, and a provenance export of the event log",
    },
    {
      aspect: "Delivery",
      traditional: "Handout or learning management system",
      perscase: "A link per team, and phases you open one at a time",
    },
    {
      aspect: "What you see of student work",
      traditional: "Collected answers",
      perscase: "Autosaved notes and answers per team, activity charts, and a CSV export",
    },
    {
      aspect: "Vetting",
      traditional: "Peer-reviewed and classroom-tested content",
      perscase: "Model output reviewed by you only; figures and jurisdiction claims need checking",
    },
    {
      aspect: "Dependencies",
      traditional: "None",
      perscase:
        "An external model provider, and a corpus of author-written notes for three disciplines",
    },
  ],
  student: [
    {
      aspect: "The case you read",
      traditional: "The same case as every other team",
      perscase:
        "For each team the case is rewritten for the team's role and point of view. The organisation or the client's situation, the figures and the questions are carried over as written and unverified; the must-cover concepts are checked again. Each team variant gets its own link.",
    },
    {
      aspect: "Getting started",
      traditional: "A handout or an upload",
      perscase: "A link, no account",
    },
    {
      aspect: "Pace",
      traditional: "The whole case at once",
      perscase: "Phases opened one at a time, with a prompt and a suggested time for each",
    },
    {
      aspect: "Help while working",
      traditional: "The instructor, when available",
      perscase:
        "Up to three hints and feedback against the rubric, labelled AI-generated and not reviewed by the instructor",
    },
    {
      aspect: "Your work",
      traditional: "Paper or a submission box",
      perscase:
        "Autosaved as you type, downloadable as one file, with model answers revealed at the last phase after you ask for feedback",
    },
    {
      aspect: "Privacy",
      traditional: "Depends on the platform",
      perscase:
        "No name collected; text you send for hints or feedback goes to an external model provider",
    },
    {
      aspect: "Where the content was checked",
      traditional: "By an editor and other instructors before you",
      perscase: "By your instructor, on this case, before release",
    },
  ],
};

const TABS: { id: Audience; label: string }[] = [
  { id: "instructor", label: "Instructor" },
  { id: "student", label: "Student" },
];

export function Comparison() {
  const [active, setActive] = useState<Audience>("instructor");
  const tabRefs = useRef<Record<Audience, HTMLButtonElement | null>>({
    instructor: null,
    student: null,
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.id === active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    const id = TABS[next].id;
    setActive(id);
    tabRefs.current[id]?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Compare as"
        onKeyDown={onKeyDown}
        className="inline-flex rounded-full bg-muted p-1"
      >
        {TABS.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`compare-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`compare-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              className={cn(
                "h-8 rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-muted",
                selected
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted-hover hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {TABS.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`compare-panel-${t.id}`}
          aria-labelledby={`compare-tab-${t.id}`}
          hidden={t.id !== active}
          className="mt-6"
        >
          {/* Below md each row is a stacked entry, so that neither column is cut off. */}
          <ul className="divide-y border-y md:hidden">
            {ROWS[t.id].map((r) => (
              <li key={r.aspect} className="py-4 text-sm">
                <p className="text-base font-semibold">{r.aspect}</p>
                <dl className="mt-2 space-y-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                      Traditional case study
                    </dt>
                    <dd className="mt-0.5 text-muted-foreground">{r.traditional}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-primary">
                      PersCase
                    </dt>
                    <dd className="mt-0.5">{r.perscase}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[30%]" />
                <col className="w-[30%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-[0.06em]">
                  <th scope="col" className="pb-3 pr-4 font-semibold">
                    <span className="sr-only">Aspect</span>
                  </th>
                  <th scope="col" className="px-4 pb-3 font-semibold text-muted-foreground">
                    Traditional case study
                  </th>
                  <th scope="col" className="px-4 pb-3 font-semibold text-primary">
                    PersCase
                  </th>
                </tr>
              </thead>
              <tbody>
                {ROWS[t.id].map((r) => (
                  <tr key={r.aspect} className="border-b align-top last:border-b-0">
                    <th scope="row" className="py-4 pr-4 text-left font-semibold">
                      {r.aspect}
                    </th>
                    <td className="px-4 py-4 text-muted-foreground">{r.traditional}</td>
                    <td className="px-4 py-4">{r.perscase}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            PersCase drafts are checked by the instructor; the readings in the tool match words
            rather than meaning.
          </p>
        </div>
      ))}
    </div>
  );
}
