import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { eq, and, desc, inArray } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseVariants, studentResponses } from "@/lib/db/schema";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass } from "@/components/ui/button";
import { andForAmpersand } from "@/lib/text/display";
import { SpawnVariantsForm } from "@/components/admin/spawn-variants-form";
import { VariantList } from "@/components/admin/variant-list";
import { CaseContentSchema } from "@/lib/generation/schema";
import { checkConceptCoverage } from "@/lib/generation/generate-case";
import { isReadOnlyCase } from "@/lib/case/seeded";
import { getDisciplinePack } from "@/lib/disciplines";
import { CARD, NOTE_MUTED } from "@/components/admin/styles";
import { EXAMPLE_CASE_NOTICE } from "@/components/admin/status-pill";
import type { DisciplineId, PhaseDefinition } from "@/lib/disciplines/types";

export const metadata = { title: "Team variants · PersCase" };

export default async function VariantsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;

  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.instructorId, instructorId)));
  if (!row) notFound();

  const variants = await db
    .select({
      id: caseVariants.id,
      token: caseVariants.inviteToken,
      learnerProfileJson: caseVariants.learnerProfileJson,
      contentJson: caseVariants.contentJson,
      viewCount: caseVariants.viewCount,
      firstViewedAt: caseVariants.firstViewedAt,
      lastViewedAt: caseVariants.lastViewedAt,
    })
    .from(caseVariants)
    .where(eq(caseVariants.caseId, id))
    .orderBy(desc(caseVariants.createdAt));

  const variantIds = variants.map((v) => v.id);
  const responses = variantIds.length === 0
    ? []
    : await db
        .select({
          variantId: studentResponses.variantId,
          phaseId: studentResponses.phaseId,
          activityType: studentResponses.activityType,
          contentJson: studentResponses.contentJson,
          updatedAt: studentResponses.updatedAt,
        })
        .from(studentResponses)
        .where(inArray(studentResponses.variantId, variantIds));

  const responsesByVariant = new Map<
    string,
    {
      phaseId: string;
      activityType: string;
      chars: number;
      text: string;
      updatedAt: string;
    }[]
  >();
  for (const r of responses) {
    let chars = 0;
    let text = "";
    if (r.activityType === "clarifying_questions") {
      const c = r.contentJson as { items?: string[] } | null;
      const items = (c?.items ?? []).filter((x) => x.trim() !== "");
      chars = items.reduce((a, b) => a + b.length, 0);
      text = items.map((x, i) => `${i + 1}. ${x}`).join("\n");
    } else {
      const c = r.contentJson as { text?: string } | null;
      text = c?.text ?? "";
      chars = text.length;
    }
    if (chars === 0) continue;
    const arr = responsesByVariant.get(r.variantId) ?? [];
    arr.push({
      phaseId: r.phaseId,
      activityType: r.activityType,
      chars,
      text,
      updatedAt: r.updatedAt.toISOString(),
    });
    responsesByVariant.set(r.variantId, arr);
  }

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const origin = `${proto}://${host}`;

  const mustCover = (row.mustCoverConcepts as string[]) ?? [];
  // Each saved response is headed by the title its team saw, not by the phase
  // id.
  const phaseTitles = Object.fromEntries(
    ((row.phasesJson as PhaseDefinition[]) ?? []).map((p) => [p.id, andForAmpersand(p.studentTitle)]),
  );
  // The approved master's scenario, so each preview can mark what its variant
  // changed against it.
  const masterParsed = row.contentJson
    ? CaseContentSchema.safeParse(row.contentJson)
    : null;
  const masterScenario = masterParsed?.success ? masterParsed.data.scenario : "";
  const variantRows = variants.map((v) => {
    const lp = v.learnerProfileJson as {
      displayName?: string | null;
      industry: string;
      role: string;
      priorKnowledge: string;
      teamSize?: number;
    };
    // Verify the personalised variant still covers every must-cover concept;
    // personalisation is meant to preserve the objective and concepts.
    const parsed = CaseContentSchema.safeParse(v.contentJson);
    // A variant whose content will not parse is reported as covering nothing,
    // which is what the same check returns for empty text.
    const coverage = checkConceptCoverage(
      parsed.success
        ? parsed.data
        : { scenario: "", discussionQuestions: [], modelAnswers: [], rubric: "" },
      mustCover,
    );
    // Everything this team receives, so the instructor can read the model
    // answers, the rubric and the glossary before the link goes out. Variants
    // are model output and are not approved one by one.
    const preview = parsed.success
      ? {
          scenario: parsed.data.scenario,
          discussionQuestions: parsed.data.discussionQuestions,
          modelAnswers: parsed.data.modelAnswers,
          rubric: parsed.data.rubric,
          glossary: parsed.data.glossary ?? [],
        }
      : null;
    return {
      id: v.id,
      token: v.token,
      learnerProfile: lp,
      coverage,
      preview,
      viewCount: v.viewCount,
      firstViewedAt: v.firstViewedAt ? v.firstViewedAt.toISOString() : null,
      lastViewedAt: v.lastViewedAt ? v.lastViewedAt.toISOString() : null,
      responseSummary: responsesByVariant.get(v.id) ?? [],
    };
  });
  // Teams in name order, so a team is easy to find in a long list.
  const teamSortName = (r: (typeof variantRows)[number]) =>
    r.learnerProfile.displayName ?? `${r.learnerProfile.role} · ${r.learnerProfile.industry}`;
  variantRows.sort((a, b) => teamSortName(a).localeCompare(teamSortName(b)));

  // Example cases (seeded or walkthrough) keep their teams; generating more is refused
  // server-side, so the form is left out and the list shown on its own.
  const seeded = isReadOnlyCase(id);
  const canSpawn = (row.status === "approved" || row.status === "released") && !seeded;

  return (
    <section>
      <PageHeader
        title="Team variants"
        back={{ href: `/admin/cases/${id}`, label: "Back to case" }}
      />
      {/* Every team variant keeps the case's learning objective; only the
          setting changes. */}
      <p className="mt-4 max-w-3xl text-base">
        <span className="font-medium">Learning objective (unchanged):</span>{" "}
        <span className="text-muted-foreground">{row.learningObjective}</span>
      </p>
      {seeded ? <p className={`mt-4 ${NOTE_MUTED}`}>{EXAMPLE_CASE_NOTICE}</p> : null}
      {!canSpawn && !seeded ? (
        <div className={`mt-8 ${CARD} p-6 text-sm`}>
          Approve the case before generating team variants.
        </div>
      ) : (
        // The list sits below the form rather than beside it, so that a preview
        // can open at the full width of the page and two can be read side by
        // side.
        <div className="mt-8 space-y-6">
          {canSpawn ? (
            <SpawnVariantsForm
              caseId={id}
              discipline={row.discipline}
              hasVariants={variantRows.length > 0}
            />
          ) : null}
          <VariantList
            variants={variantRows}
            origin={origin}
            caseId={id}
            masterScenario={masterScenario}
            phaseTitles={phaseTitles}
            redraftNoteExample={
              getDisciplinePack(row.discipline as DisciplineId).redraftNoteExample
            }
            readOnly={seeded}
            released={row.status === "released"}
            caseIndustry={
              (row.targetLearnerProfile as { industry?: string } | null)?.industry ?? ""
            }
          />
          {/* Release lives on the case page. Until it happens the team links
              open nothing, so the page points back there once teams exist. */}
          {variantRows.length > 0 && row.status !== "released" && !seeded ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`/admin/cases/${id}`} className={buttonClass("outline", "sm")}>
                Next: release the case
              </Link>
              <span className="text-sm text-muted-foreground">
                Students can open the team links once the case is released.
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
