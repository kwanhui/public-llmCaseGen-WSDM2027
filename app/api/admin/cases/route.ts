import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { getDisciplinePack } from "@/lib/disciplines";
import { logCaseEvent } from "@/lib/case/events";

const OBJECTIVE_MIN = 10;
const OBJECTIVE_MAX = 2000;

const CreateCaseSchema = z.object({
  discipline: z.enum(["finance", "marketing", "social_work"]),
  learningObjective: z.string().min(OBJECTIVE_MIN).max(OBJECTIVE_MAX),
  difficulty: z.enum(["novice", "intermediate", "advanced"]),
  mustCoverConcepts: z.array(z.string().min(1).max(80)).max(20),
  targetLearnerProfile: z.object({
    industry: z.string().min(1).max(120),
    role: z.string().min(1).max(120),
    priorKnowledge: z.string().min(1).max(120),
  }),
});

// The limits above, in the words of the form, so a rejected brief says what to
// change instead of the word "validation".
const FIELD_MESSAGE: Record<string, string> = {
  learningObjective:
    `The learning objective has to be between ${OBJECTIVE_MIN} and ${OBJECTIVE_MAX} characters.`,
  mustCoverConcepts:
    "Each must-cover concept has to be 80 characters or fewer, and there can be at most 20 of them.",
  "targetLearnerProfile.industry":
    "The practice context has to be 120 characters or fewer.",
  "targetLearnerProfile.role": "The role has to be 120 characters or fewer.",
  "targetLearnerProfile.priorKnowledge":
    "Prior knowledge has to be 120 characters or fewer.",
  discipline: "Choose one of the three disciplines.",
  difficulty: "Choose one of the three difficulty levels.",
};

function validationMessage(error: z.ZodError): string {
  for (const issue of error.issues) {
    const path = issue.path.join(".");
    const named = FIELD_MESSAGE[path] ?? FIELD_MESSAGE[path.replace(/\.\d+$/, "")];
    if (named) return named;
  }
  return "The brief could not be saved as it stands. Check the required fields.";
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const instructorId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = CreateCaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "validation",
        message: validationMessage(parsed.error),
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const pack = getDisciplinePack(parsed.data.discipline);
  // Deep-copy default phases so the instructor can edit them per case without
  // mutating the discipline pack.
  const phasesJson = JSON.parse(JSON.stringify(pack.defaultPhases));

  const [row] = await db
    .insert(cases)
    .values({
      instructorId,
      discipline: parsed.data.discipline,
      learningObjective: parsed.data.learningObjective,
      difficulty: parsed.data.difficulty,
      mustCoverConcepts: parsed.data.mustCoverConcepts,
      targetLearnerProfile: parsed.data.targetLearnerProfile,
      phasesJson,
      status: "draft",
    })
    .returning({ id: cases.id });

  await logCaseEvent({
    caseId: row.id,
    eventType: "created",
    metadata: { discipline: parsed.data.discipline, difficulty: parsed.data.difficulty },
  });

  return NextResponse.json({ id: row.id }, { status: 201 });
}
