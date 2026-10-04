import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { isSeededCase } from "@/lib/case/seeded";
import { DISCIPLINE_PACKS } from "@/lib/disciplines";
import type { PhaseDefinition } from "@/lib/disciplines/types";
import { CaseContentSchema, type CaseContent } from "@/lib/generation/schema";
import { generateHint } from "@/lib/generation/hint";
import { assessAttempt } from "@/lib/generation/assess-attempt";
import { describeGenerationModel } from "@/lib/llm/client";
import {
  DEMO_COST,
  DEMO_MAX_OUTPUT_TOKENS,
  guardDemoRequest,
  invalid,
  modelFailed,
  readDemoJson,
  withTiming,
} from "@/lib/demo/guards";
import {
  DEMO_MAX_HINTS,
  DemoStudentCaseRequestSchema,
  DemoStudentRequestSchema,
  type DemoStudentCaseResponse,
  type DemoStudentResponse,
} from "@/lib/demo/contracts";
import { plainStudentReply } from "@/lib/demo/plain-arms";
import { withSchemaRetry } from "@/lib/demo/schema-retry";

// Public, unauthenticated. The student tools (graduated hint, rubric feedback)
// against either a seeded case or case content the page holds, set beside one
// plain reply. Nothing is written to the database and no case event is logged.
// A seeded case is only read.
//
// Arm "case" (no model call, no cost) returns a seeded case's scenario, its
// discussion questions and the phase's task, so that the page can show the
// questions before the student sends anything.

// The same minimum as the token-scoped feedback route.
const MIN_WORDS = 40;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Every discipline's default phases. Phase ids are unique across the packs, so
// a phase id sent with visitor-held content can be resolved without knowing
// the discipline.
const DEFAULT_PHASES: PhaseDefinition[] = Object.values(DISCIPLINE_PACKS).flatMap(
  (p) => p.defaultPhases,
);

type SeedRead =
  | { ok: true; content: CaseContent; phases: PhaseDefinition[] }
  | { ok: false; response: NextResponse };

async function readSeed(id: string): Promise<SeedRead> {
  if (!isSeededCase(id)) {
    return {
      ok: false,
      response: invalid([{ path: ["source", "id"], message: "Only seeded cases can be read here." }]),
    };
  }
  const [row] = await db
    .select({ contentJson: cases.contentJson, phasesJson: cases.phasesJson })
    .from(cases)
    .where(eq(cases.id, id));
  if (!row) return { ok: false, response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  const valid = CaseContentSchema.safeParse(row.contentJson);
  if (!valid.success) {
    return { ok: false, response: NextResponse.json({ error: "invalid_content" }, { status: 422 }) };
  }
  return { ok: true, content: valid.data, phases: (row.phasesJson as PhaseDefinition[] | null) ?? [] };
}

function phaseOf(phases: PhaseDefinition[], phaseId: string | undefined): PhaseDefinition | undefined {
  return phaseId ? phases.find((p) => p.id === phaseId) : phases[phases.length - 1];
}

export async function POST(req: Request) {
  const read = await readDemoJson(req);
  if (!read.ok) return read.response;

  // The "case" arm reads a seeded case and costs nothing; every other request
  // is charged as a student call. An unknown arm is charged and then rejected.
  const armPeek = (read.body as { arm?: unknown } | null)?.arm;
  const blocked = await guardDemoRequest(req, armPeek === "case" ? 0 : DEMO_COST.student);
  if (blocked) return blocked;

  if (armPeek === "case") {
    const caseParsed = DemoStudentCaseRequestSchema.safeParse(read.body);
    if (!caseParsed.success) return invalid(caseParsed.error.issues);
    const seed = await readSeed(caseParsed.data.source.id);
    if (!seed.ok) return seed.response;
    const phase = phaseOf(seed.phases, caseParsed.data.phaseId);
    return NextResponse.json({
      arm: "case",
      caseText: seed.content.scenario,
      discussionQuestions: seed.content.discussionQuestions,
      phasePrompt: phase ? { title: phase.studentTitle, prompt: phase.studentPrompt } : null,
    } satisfies DemoStudentCaseResponse);
  }

  const parsed = DemoStudentRequestSchema.safeParse(read.body);
  if (!parsed.success) return invalid(parsed.error.issues);
  const { arm, mode, source, phaseId, message, questionIndex } = parsed.data;
  const previousHints = parsed.data.previousHints ?? [];
  const maxTokens = DEMO_MAX_OUTPUT_TOKENS.student;

  // Resolve the case content and the open phase.
  let content: CaseContent;
  let phaseRow: PhaseDefinition | undefined;
  if (source.kind === "seed") {
    const seed = await readSeed(source.id);
    if (!seed.ok) return seed.response;
    content = seed.content;
    phaseRow = phaseOf(seed.phases, phaseId);
  } else {
    content = source.content;
    phaseRow = phaseId ? DEFAULT_PHASES.find((p) => p.id === phaseId) : undefined;
  }

  const modelId = describeGenerationModel();
  // A seeded case's scenario goes back with every reply, since the page does
  // not hold that case's text.
  const seedText = source.kind === "seed" ? { caseText: content.scenario } : {};

  try {
    if (arm === "plain") {
      const { result: text, elapsedMs } = await withTiming(() =>
        plainStudentReply(
          content,
          phaseRow ? { label: phaseRow.studentTitle, prompt: phaseRow.studentPrompt } : undefined,
          message,
          maxTokens,
        ),
      );
      return NextResponse.json({
        arm,
        mode,
        text,
        modelId,
        elapsedMs,
        ...seedText,
      } satisfies DemoStudentResponse);
    }

    if (mode === "hint") {
      if (previousHints.length >= DEMO_MAX_HINTS) {
        return NextResponse.json(
          {
            error: "hint_limit",
            message: `You have used all ${DEMO_MAX_HINTS} hints for this phase.`,
          },
          { status: 409 },
        );
      }
      // A message that names a discussion question gets a hint about that
      // question: the hint writer is told which question it is and is given
      // no phase, whose task would otherwise steer the hint away from it. The
      // page sends no phaseId then; a seeded case would still fall back to
      // its last phase, so the phase is dropped here too.
      const questionText =
        questionIndex !== undefined ? content.discussionQuestions[questionIndex] : undefined;
      const asked =
        questionIndex !== undefined && questionText !== undefined
          ? { n: questionIndex + 1, text: questionText }
          : null;
      const phase =
        phaseRow && !asked
          ? {
              id: phaseRow.id,
              label: phaseRow.studentTitle,
              prompt: phaseRow.studentPrompt,
              disciplineHint: phaseRow.disciplineHint,
            }
          : undefined;
      const hintMessage =
        asked
          ? `The student is asking about discussion question ${asked.n}: ${asked.text}\n\n${message}`
          : message;
      const { result, elapsedMs } = await withTiming(() =>
        generateHint(content, hintMessage, { phase, previousHints, maxTokens }),
      );
      return NextResponse.json({
        arm: "perscase",
        mode: "hint",
        hint: result.hint,
        level: result.level,
        levelName: result.levelName,
        index: previousHints.length + 1,
        total: DEMO_MAX_HINTS,
        modelId,
        elapsedMs,
        ...seedText,
      } satisfies DemoStudentResponse);
    }

    // perscase feedback
    const words = wordCount(message);
    if (words < MIN_WORDS) {
      return NextResponse.json({
        arm: "perscase",
        mode: "feedback",
        notRated: {
          reason: `Your answer is ${words} word${words === 1 ? "" : "s"} long, which is too short to judge against the rubric. Write at least ${MIN_WORDS} words and ask again.`,
        },
        modelId,
        elapsedMs: 0,
        ...seedText,
      } satisfies DemoStudentResponse);
    }
    const phase = phaseRow
      ? {
          id: phaseRow.id,
          label: phaseRow.studentTitle,
          prompt: phaseRow.studentPrompt,
          hint: phaseRow.disciplineHint,
        }
      : undefined;
    const { result: assessment, elapsedMs } = await withTiming(() =>
      withSchemaRetry("student/feedback", () =>
        assessAttempt(content, message, { phase, audience: "student", maxTokens }),
      ),
    );
    if (!assessment.rated) {
      return NextResponse.json({
        arm: "perscase",
        mode: "feedback",
        notRated: {
          reason:
            assessment.reasonNotRated.trim() ||
            "Your answer does not engage with anything in this case, so there is nothing to rate against the rubric.",
        },
        modelId,
        elapsedMs,
        ...seedText,
      } satisfies DemoStudentResponse);
    }
    return NextResponse.json({
      arm: "perscase",
      mode: "feedback",
      assessment,
      modelId,
      elapsedMs,
      ...seedText,
    } satisfies DemoStudentResponse);
  } catch (err) {
    return modelFailed(err);
  }
}
