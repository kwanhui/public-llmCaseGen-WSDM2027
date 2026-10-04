"use client";

import { useState } from "react";
import { StageLane, type Stage } from "@/components/landing/stage-details";
import { cn } from "@/lib/utils";

// Screenshots in public/landing/, captured from the seeded finance case; the
// hints capture is from the seeded marketing case, the one left open at its
// answer phase. Sizes are the PNGs' pixels.
const shot = (name: string, width: number, height: number, alt: string) => ({
  src: `/landing/${name}.png`,
  width,
  height,
  alt,
});

// Stage names 1 to 4 follow components/admin/case-wizard/wizard-progress.tsx.
// The contrastive view comes last so that the arrow keys walk stages 1 to 5
// first; the diagram draws it under stage 4.
const INSTRUCTOR: Stage[] = [
  {
    label: "1 Input",
    detail:
      "The instructor writes the brief: a learning objective, a difficulty level, up to four must-cover concepts and a learner profile (industry, role, prior knowledge). The draft, the readings and the variants all start from this brief.",
    shot: shot("input", 1262, 1446, "The brief form of the new-case wizard, filled with the example finance brief"),
  },
  {
    label: "2 Retrieval",
    detail:
      "The brief is embedded and matched against the discipline's notes; up to five notes above a similarity threshold are kept. The retrieved notes are listed with each score, the weak matches, the first note left out and why, and any concept that no note mentions.",
    shot: shot("retrieval", 2100, 574, "The retrieved-notes table of the finance case, with a similarity score per note"),
  },
  {
    label: "3 Generation",
    detail:
      "The model drafts a scenario, four to six discussion questions with model answers, a rubric and key terms, validated against a schema. The draft then shows which must-cover concepts are present, by looking for each concept's words.",
    shot: shot("generation", 1052, 1024, "The must-cover check above the scenario in the draft editor of the finance case"),
  },
  {
    label: "4 Edit and approve",
    detail:
      "The instructor edits any section in place or regenerates it with a note; the must-cover concepts are checked again after each change. Nothing reaches a student before approval.",
    shot: shot("edit", 2100, 496, "The discussion questions section of the draft editor, with its Regenerate control"),
  },
  {
    label: "5 Personalised variant per team",
    detail:
      "For each team the case is rewritten for the team's role and point of view. The organisation or the client's situation, the figures and the questions are carried over as written and unverified; the must-cover concepts are checked again. Each team variant gets its own link.",
    shot: shot("variants", 2104, 922, "Two team variant cards, each with its link and must-cover line"),
  },
  {
    label: "Contrastive view",
    detail:
      "An instructor screen, after sign-in: the same brief run as a plain prompt (one prompt with the brief, no retrieval, no output schema, no discipline prompt), as a structured draft without retrieval, and as the instructor's draft, side by side with the same word-level readings.",
    shot: shot("contrastive", 2100, 910, "The readings table of the contrastive view for the finance case"),
    aside: true,
  },
];

const STUDENT: Stage[] = [
  {
    label: "Open the team link",
    detail:
      "Students open their team's link in a browser; there is no account and no name is collected. The page shows the scenario, the objective, the key terms and the current phase.",
    shot: shot("student", 1472, 1500, "The top of a student page: the objective and the scenario"),
  },
  {
    label: "Work through the phases",
    detail:
      "The instructor opens the phases one at a time, each with a prompt and a suggested time. Notes and answers autosave as the team types.",
    shot: shot("phases", 1472, 1666, "The phase stepper and the open phase on a student page"),
  },
  {
    label: "Hints and feedback",
    detail:
      "In the answer phase a team can ask for up to three hints, each more specific than the last, and once for feedback graded against the rubric. Both are AI-generated and labelled as not reviewed by the instructor.",
    shot: shot("hints", 1372, 604, "The answer box with the Get a hint and Get feedback buttons"),
  },
  {
    label: "Download my work",
    detail:
      "A team can download its notes and answers as one file. Model answers are revealed at the last phase after the team asks for feedback.",
    shot: shot("download", 1472, 178, "The Download my work control at the foot of a student page"),
  },
];

function LaneLabel({ children, tone }: { children: string; tone: "primary" | "student" }) {
  return (
    <p
      aria-hidden="true"
      className={cn(
        "mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em]",
        tone === "primary" ? "text-primary" : "text-student",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "primary" ? "bg-primary" : "bg-student",
        )}
      />
      {children}
    </p>
  );
}

// The hand-off from the last instructor stage to the first student stage. From
// md up it leaves the right of the instructor band, turns left and drops into
// the student band on the left; below md it is a short vertical line. A label
// for the hand-off, not a control: plain muted text.
function TeamLink() {
  return (
    <div aria-hidden="true" className="cursor-default select-none">
      <div className="flex items-center gap-2 py-1 pl-8 text-xs text-muted-foreground md:hidden">
        <span className="relative block h-8 w-px bg-foreground/25">
          <ArrowTip className="absolute -bottom-px left-1/2 -translate-x-1/2" />
        </span>
        <span>team link</span>
      </div>
      <div className="relative hidden h-14 md:block">
        {/* Down from the instructor side, then left along the middle. */}
        <span className="absolute left-[calc(10%+1rem)] right-[10%] top-0 h-1/2 rounded-br-2xl border-b border-r border-foreground/25" />
        {/* Round the corner and down into the student band. */}
        <span className="absolute left-[10%] top-1/2 h-1/2 w-4 rounded-tl-2xl border-l border-t border-foreground/25" />
        <ArrowTip className="absolute bottom-0 left-[10%] -translate-x-1/2" />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-xs font-medium text-muted-foreground">
          team link
        </span>
      </div>
    </div>
  );
}

function ArrowTip({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 6"
      className={cn("h-1.5 w-2.5 text-foreground/40", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 1l4 4 4-4" />
    </svg>
  );
}

const HEADING_ID = "workflow-heading";

export function WorkflowDiagram() {
  // One selection for the whole diagram: opening a student stage closes the
  // instructor panel, and the reverse. Stage 1 is open on first render.
  const [open, setOpen] = useState<{ lane: "instructor" | "student"; index: number }>({
    lane: "instructor",
    index: 0,
  });
  return (
    <>
      <h2 id={HEADING_ID} className="mb-6 text-2xl font-semibold sm:text-3xl">
        How a case moves from brief to student
      </h2>
      <figure aria-labelledby={HEADING_ID} className="m-0">
        <div className="rounded-2xl bg-primary/[0.06] p-4 ring-1 ring-inset ring-primary/10 md:p-6">
          <LaneLabel tone="primary">Instructor</LaneLabel>
          <div role="group" aria-label="Instructor stages">
            <StageLane
              lane="instructor"
              stages={INSTRUCTOR}
              open={open.lane === "instructor" ? open.index : null}
              onOpen={(index) => setOpen({ lane: "instructor", index })}
              asideAfter={3}
            />
          </div>
        </div>

        <TeamLink />

        <div className="rounded-2xl bg-muted/70 p-4 ring-1 ring-inset ring-border/60 md:p-6">
          <LaneLabel tone="student">Student</LaneLabel>
          <div role="group" aria-label="Student stages">
            <StageLane
              lane="student"
              stages={STUDENT}
              open={open.lane === "student" ? open.index : null}
              onOpen={(index) => setOpen({ lane: "student", index })}
            />
          </div>
        </div>
      </figure>
    </>
  );
}
