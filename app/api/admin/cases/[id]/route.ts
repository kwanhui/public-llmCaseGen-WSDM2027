import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { CaseContentSchema, CASE_SECTIONS } from "@/lib/generation/schema";
import { logCaseEvent } from "@/lib/case/events";
import { seededCaseGuard } from "@/lib/case/seeded";
import { caseRemovalSummary } from "@/lib/case/removal";

const PhaseDefinitionSchema = z.object({
  id: z.string().min(1).max(80),
  order: z.number().int().min(0),
  label: z.string().min(1).max(200),
  studentTitle: z.string().min(1).max(200),
  studentPrompt: z.string().min(1).max(4000),
  activities: z.array(z.enum(["clarifying_questions", "notes", "answer_attempt"])).min(0).max(3),
  disciplineHint: z.string().max(500).optional(),
  suggestedMinutes: z.number().int().min(1).max(240).optional(),
});

// The case brief (objective, difficulty, concepts, learner profile). Editable
// only before approval, so an instructor can iterate on the brief and
// regenerate the whole case rather than starting a new wizard.
const SpecSchema = z.object({
  learningObjective: z.string().min(10).max(2000),
  difficulty: z.enum(["novice", "intermediate", "advanced"]),
  mustCoverConcepts: z.array(z.string().min(1).max(120)).max(20),
  targetLearnerProfile: z.object({
    industry: z.string().min(1).max(200),
    role: z.string().min(1).max(200),
    priorKnowledge: z.string().min(1).max(200),
  }),
});

const UpdateCaseSchema = z
  .object({
    contentJson: CaseContentSchema.partial().optional(),
    phasesJson: z.array(PhaseDefinitionSchema).min(1).max(10).optional(),
    spec: SpecSchema.optional(),
    // Set when the save is the editor putting back the text a regeneration
    // replaced, so the event stream can tell an acceptance from a rejection.
    restoredSection: z.enum(CASE_SECTIONS as [string, ...string[]]).optional(),
  })
  .refine(
    (v) =>
      v.contentJson !== undefined ||
      v.phasesJson !== undefined ||
      v.spec !== undefined,
    { message: "Provide contentJson, phasesJson, or spec" },
  );

// Characters held by one section of a case, for the size of an edit. The
// glossary counts as a section here even though it cannot be regenerated on
// its own, because instructors do edit it by hand.
type EditableSection = (typeof CASE_SECTIONS)[number] | "glossary";
const EDITABLE_SECTIONS: EditableSection[] = [...CASE_SECTIONS, "glossary"];

function sectionChars(content: Record<string, unknown> | null, section: EditableSection): number {
  const value = content?.[section];
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) {
    return value.reduce<number>((total, item) => {
      if (typeof item === "string") return total + item.length;
      if (item && typeof item === "object") {
        const entry = item as { term?: string; definition?: string };
        return total + (entry.term?.length ?? 0) + (entry.definition?.length ?? 0);
      }
      return total;
    }, 0);
  }
  return 0;
}

// Which sections the save changed, and by how many characters each. Read from
// the stored row and the merged content rather than from the request, so a
// field the client resent unchanged does not count as an edit.
function sectionDeltas(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): { sections: string[]; charDelta: Record<string, number> } {
  const sections: string[] = [];
  const charDelta: Record<string, number> = {};
  for (const section of EDITABLE_SECTIONS) {
    if (JSON.stringify(before?.[section] ?? null) === JSON.stringify(after[section] ?? null)) {
      continue;
    }
    sections.push(section);
    charDelta[section] = sectionChars(after, section) - sectionChars(before, section);
  }
  return { sections, charDelta };
}

async function loadOwned(id: string, instructorId: string) {
  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  return row ?? null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  const seeded = seededCaseGuard(id);
  if (seeded) return seeded;

  const existing = await loadOwned(id, instructorId);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = UpdateCaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updates: Partial<typeof cases.$inferInsert> = { updatedAt: new Date() };
  let contentChange: { sections: string[]; charDelta: Record<string, number> } | null = null;

  if (parsed.data.contentJson) {
    const merged = {
      schemaVersion: 1,
      ...(existing.contentJson as object | null),
      ...parsed.data.contentJson,
    };
    contentChange = sectionDeltas(
      existing.contentJson as Record<string, unknown> | null,
      merged as Record<string, unknown>,
    );
    updates.contentJson = merged;
    if (existing.status === "draft" || existing.status === "generating") {
      updates.status = "editing";
    }
  }
  if (parsed.data.phasesJson) {
    updates.phasesJson = parsed.data.phasesJson;
  }
  if (parsed.data.spec) {
    if (existing.status === "approved" || existing.status === "released") {
      return NextResponse.json(
        { error: "spec_locked", message: "The brief cannot be edited after approval." },
        { status: 409 },
      );
    }
    updates.learningObjective = parsed.data.spec.learningObjective;
    updates.difficulty = parsed.data.spec.difficulty;
    updates.mustCoverConcepts = parsed.data.spec.mustCoverConcepts;
    updates.targetLearnerProfile = parsed.data.spec.targetLearnerProfile;
  }

  await db.update(cases).set(updates).where(eq(cases.id, id));
  if (parsed.data.restoredSection) {
    await logCaseEvent({
      caseId: id,
      eventType: "section_restored",
      metadata: {
        section: parsed.data.restoredSection,
        charDelta: contentChange?.charDelta ?? {},
      },
    });
  } else {
    await logCaseEvent({
      caseId: id,
      eventType: "edit_saved",
      metadata: {
        contentChanged: !!parsed.data.contentJson,
        phasesChanged: !!parsed.data.phasesJson,
        specChanged: !!parsed.data.spec,
        // Which sections this save changed, and the change in characters for
        // each, so that editing effort can be read from the event stream.
        sectionsChanged: contentChange?.sections ?? [],
        charDelta: contentChange?.charDelta ?? {},
      },
    });
  }

  return NextResponse.json({ ok: true });
}

// Deletes a case the signed-in instructor owns, released or not. Seeded
// example cases are refused (403) and another instructor's case reads as not
// found (404). A released case may be deleted so that an instructor who
// released a trial case is not stuck with it; the case page confirms first and
// states the counts from caseRemovalSummary. The response repeats the counts
// actually removed.
//
// No "deleted" event is logged: case_events cascades from the case row, so an
// event written for this case would be removed with it (and one written after
// the delete would violate the foreign key).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;
  const seeded = seededCaseGuard(id);
  if (seeded) return seeded;

  const existing = await loadOwned(id, instructorId);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const removed = await caseRemovalSummary(id);
  await db
    .delete(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  return NextResponse.json({ ok: true, removed });
}
