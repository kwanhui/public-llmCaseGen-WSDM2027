import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseVariants } from "@/lib/db/schema";
import { CaseContentSchema } from "@/lib/generation/schema";
import { checkConceptCoverage } from "@/lib/generation/generate-case";
import { personaliseCaseContent } from "@/lib/generation/personalize";
import { newInviteToken } from "@/lib/case/invite";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";
import type { CaseInput } from "@/lib/disciplines/types";

// Prior knowledge is not collected per team. It stays at the master case's
// value, which is the one the variant prompt is given.
const OverrideSchema = z.object({
  displayName: z.string().min(1).max(120).optional(), // team name
  industry: z.string().min(1).max(120).optional(),
  role: z.string().min(1).max(120).optional(),
  teamSize: z.number().int().min(1).max(12).optional(),
});

const RequestSchema = z.object({
  // One customised case is generated per student team. count = number of teams.
  count: z.number().int().min(1).max(20).optional(),
  overrides: z.array(OverrideSchema).max(20).optional(),
  // Default students per team, adjustable; per-team overrides win.
  teamSize: z.number().int().min(1).max(12).optional(),
  // Regenerate one existing variant in place, keeping its team profile and its
  // invite link. Handled here rather than in a route of its own so that the
  // ownership and status checks above it apply unchanged.
  regenerateVariantId: z.string().uuid().optional(),
  // Optional instructor note for a redraft of one variant. It reaches the
  // prompt and is recorded with the event.
  editorNote: z.string().max(2000).optional(),
});

const MAX_PARALLEL = 4;

// One result row per team, whether it was created or not, so the form can list
// outcomes rather than a single count.
interface TeamResult {
  index: number;
  teamName: string;
  status: "created" | "failed";
  id?: string;
  token?: string;
  conceptsMissing?: string[];
  message?: string;
  // A redraft whose scenario, questions, model answers and rubric are the
  // same as the text it replaced.
  unchanged?: boolean;
}

// The four fields a student reads, compared after spacing. The glossary is
// left out: a redraft that changes only a definition leaves the case as it was.
function sameCaseText(previous: unknown, next: unknown): boolean {
  const a = CaseContentSchema.safeParse(previous);
  const b = CaseContentSchema.safeParse(next);
  if (!a.success || !b.success) return false;
  const norm = (x: string) => x.replace(/\s+/g, " ").trim();
  const pick = (c: typeof a.data) =>
    JSON.stringify([
      norm(c.scenario),
      c.discussionQuestions.map(norm),
      c.modelAnswers.map(norm),
      norm(c.rubric),
    ]);
  return pick(a.data) === pick(b.data);
}

function teamLabel(
  override: { displayName?: string; industry?: string; role?: string },
  index: number,
): string {
  if (override.displayName) return override.displayName;
  const fromProfile = [override.industry, override.role].filter(Boolean).join(" · ");
  return fromProfile || `Team ${index + 1}`;
}

// One automatic retry per team. A structured-output failure is usually
// transient, and one malformed reply should not fail the whole run.
async function personaliseWithRetry(
  args: Parameters<typeof personaliseCaseContent>[0],
): Promise<{ content: Awaited<ReturnType<typeof personaliseCaseContent>> } | { error: string }> {
  let lastError = "Unknown error";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return { content: await personaliseCaseContent(args) };
    } catch (err) {
      lastError = err instanceof Error ? err.message : "Unknown error";
    }
  }
  return { error: lastError };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  const seeded = seededCaseGuard(id);
  if (seeded) return seeded;

  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (row.status !== "approved" && row.status !== "released") {
    return NextResponse.json(
      { error: "approve_first" },
      { status: 409 },
    );
  }

  const contentParse = row.contentJson ? CaseContentSchema.safeParse(row.contentJson) : null;
  if (!contentParse?.success) {
    return NextResponse.json({ error: "invalid_content" }, { status: 422 });
  }
  const baseContent = contentParse.data;

  const caseInput: CaseInput = {
    discipline: row.discipline as CaseInput["discipline"],
    learningObjective: row.learningObjective,
    difficulty: row.difficulty as CaseInput["difficulty"],
    mustCoverConcepts: (row.mustCoverConcepts as string[]) ?? [],
    targetLearnerProfile: row.targetLearnerProfile as CaseInput["targetLearnerProfile"],
  };

  // Regenerate one existing variant, keeping its team profile and its link, so
  // that a flagged variant can be repaired without reissuing the team's URL.
  if (parsed.data.regenerateVariantId) {
    const [existing] = await db
      .select()
      .from(caseVariants)
      .where(
        and(
          eq(caseVariants.id, parsed.data.regenerateVariantId),
          eq(caseVariants.caseId, id),
        ),
      );
    if (!existing) {
      return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
    }
    const lp = existing.learnerProfileJson as {
      displayName?: string | null;
      industry?: string;
      role?: string;
    };
    const override = {
      displayName: lp.displayName ?? undefined,
      industry: lp.industry,
      role: lp.role,
    };
    const name = teamLabel(override, 0);
    const editorNote = parsed.data.editorNote?.trim() || undefined;
    const outcome = await personaliseWithRetry({
      base: baseContent,
      caseInput,
      override,
      editorNote,
    });
    if ("error" in outcome) {
      await logCaseEvent({
        caseId: id,
        variantId: existing.id,
        eventType: "generation_failed",
        metadata: { stage: "variant_regeneration", team: name, detail: outcome.error },
      });
      return NextResponse.json(
        {
          results: [
            {
              index: 0,
              teamName: name,
              status: "failed",
              message:
                "The model did not return a usable variant, on the first attempt or on the automatic retry. This team's variant is unchanged.",
            } satisfies TeamResult,
          ],
        },
        { status: 200 },
      );
    }
    const unchanged = sameCaseText(existing.contentJson, outcome.content);
    if (!unchanged) {
      await db
        .update(caseVariants)
        .set({ contentJson: outcome.content })
        .where(eq(caseVariants.id, existing.id));
    }
    const coverage = checkConceptCoverage(outcome.content, caseInput.mustCoverConcepts);
    await logCaseEvent({
      caseId: id,
      variantId: existing.id,
      eventType: "variant_spawned",
      metadata: {
        regenerated: true,
        team: name,
        editorNote: editorNote ?? null,
        conceptsMissing: coverage.missing,
        unchanged,
      },
    });
    return NextResponse.json({
      results: [
        {
          index: 0,
          teamName: name,
          status: "created",
          id: existing.id,
          token: existing.inviteToken,
          conceptsMissing: coverage.missing,
          unchanged,
        } satisfies TeamResult,
      ],
    });
  }

  const overrides = parsed.data.overrides ?? [];
  const count = parsed.data.count ?? Math.max(1, overrides.length);
  const defaultTeamSize = parsed.data.teamSize ?? 4;
  // Prefer explicit overrides; pad with empty overrides up to count.
  const items: z.infer<typeof OverrideSchema>[] = [];
  for (let i = 0; i < count; i++) {
    items.push(overrides[i] ?? {});
  }

  // Generate in small parallel batches to stay under the function timeout. Each
  // team returns a result either way, so the caller can report per team rather
  // than collapsing the run into one message.
  const results: TeamResult[] = [];

  for (let i = 0; i < items.length; i += MAX_PARALLEL) {
    const batch = items.slice(i, i + MAX_PARALLEL);
    const settled = await Promise.all(
      batch.map(async (override, k): Promise<TeamResult> => {
        const index = i + k;
        const name = teamLabel(override, index);
        const outcome = await personaliseWithRetry({
          base: baseContent,
          caseInput,
          override,
        });
        if ("error" in outcome) {
          return {
            index,
            teamName: name,
            status: "failed",
            message:
              "The model did not return a usable variant, on the first attempt or on the automatic retry. Nothing was saved for this team.",
          };
        }
        try {
          const token = newInviteToken();
          const [v] = await db
            .insert(caseVariants)
            .values({
              caseId: id,
              learnerProfileJson: {
                displayName: override.displayName ?? null,
                industry: override.industry ?? caseInput.targetLearnerProfile.industry,
                role: override.role ?? caseInput.targetLearnerProfile.role,
                priorKnowledge: caseInput.targetLearnerProfile.priorKnowledge,
                teamSize: override.teamSize ?? defaultTeamSize,
              },
              contentJson: outcome.content,
              inviteToken: token,
            })
            .returning({ id: caseVariants.id });
          // Verify the personalised variant still covers every must-cover
          // concept; the objective and concepts are meant to be preserved.
          const coverage = checkConceptCoverage(
            outcome.content,
            caseInput.mustCoverConcepts,
          );
          return {
            index,
            teamName: name,
            status: "created",
            id: v.id,
            token,
            conceptsMissing: coverage.missing,
          };
        } catch {
          return {
            index,
            teamName: name,
            status: "failed",
            message: "The variant was drafted but could not be saved. Nothing was kept for this team.",
          };
        }
      }),
    );
    results.push(...settled);
  }

  for (const r of results) {
    if (r.status === "created") {
      await logCaseEvent({
        caseId: id,
        variantId: r.id,
        eventType: "variant_spawned",
        metadata: { team: r.teamName, conceptsMissing: r.conceptsMissing },
      });
    } else {
      await logCaseEvent({
        caseId: id,
        eventType: "generation_failed",
        metadata: { stage: "variant_generation", team: r.teamName },
      });
    }
  }

  return NextResponse.json({ results });
}
