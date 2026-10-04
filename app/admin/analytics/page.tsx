import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases } from "@/lib/db/schema";
import { CaseFilter } from "@/components/admin/case-filter";
import { isSeededCase } from "@/lib/case/seeded";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  AuthoringTimeChart,
  RegenCountChart,
  StudentActivityChart,
  EngagementChart,
} from "@/components/analytics/charts";
import {
  topLineMetrics,
  casesByDiscipline,
  regenerationCountsBySection,
  studentActivityOverTime,
  engagementByDiscipline,
  qualityFeedback,
  seededCaseCount,
} from "@/lib/analytics/queries";
import { CARD, NUM, TABLE, TD, TH, THEAD_ROW, TR } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number | null): string {
  if (seconds === null || isNaN(seconds)) return "n/a";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

function formatPct(value: number | null): string {
  if (value === null || isNaN(value)) return "n/a";
  return `${Math.round(value)}%`;
}

function formatNumber(value: number | null, digits = 1): string {
  if (value === null || isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

export const metadata = { title: "Analytics · PersCase" };

const DISCIPLINE_LABELS: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  social_work: "Social work",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ caseId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const instructorId = (session.user as { id: string }).id;
  const { caseId: caseParam } = await searchParams;

  // The instructor's cases for the filter. A caseId that is not one of them is
  // ignored, so the page falls back to all cases.
  let myCases: { id: string; discipline: string; learningObjective: string }[] = [];
  try {
    myCases = await db
      .select({ id: cases.id, discipline: cases.discipline, learningObjective: cases.learningObjective })
      .from(cases)
      .where(eq(cases.instructorId, instructorId))
      .orderBy(desc(cases.createdAt));
  } catch {
    // No database: the queries below fail too and the page says so.
  }
  const caseId = myCases.some((c) => c.id === caseParam) ? caseParam : undefined;
  const filterOptions = myCases.map((c) => {
    const objective =
      c.learningObjective.length > 70 ? `${c.learningObjective.slice(0, 69)}…` : c.learningObjective;
    return {
      id: c.id,
      label: `${DISCIPLINE_LABELS[c.discipline] ?? c.discipline}: ${objective}${isSeededCase(c.id) ? " (example case)" : ""}`,
    };
  });

  let metrics, byDiscipline, regenCounts, activity, engagement, quality, seeded;
  try {
    [metrics, byDiscipline, regenCounts, activity, engagement, quality, seeded] =
      await Promise.all([
      topLineMetrics(instructorId, caseId),
      casesByDiscipline(instructorId, caseId),
      regenerationCountsBySection(instructorId, caseId),
      studentActivityOverTime(instructorId, 7, caseId),
      engagementByDiscipline(instructorId, caseId),
      qualityFeedback(instructorId, caseId),
      seededCaseCount(instructorId, caseId),
    ]);
  } catch {
    return (
      <section>
        <PageHeader title="Analytics" />
        <div className="mt-8">
          <EmptyState
            variant="muted"
            title="Analytics unavailable"
            description="The database cannot be reached. Check POSTGRES_URL."
          />
        </div>
      </section>
    );
  }

  if (metrics.casesDrafted === 0) {
    return (
      <section>
        <PageHeader title="Analytics" />
        <div className="mt-8">
          <EmptyState
            variant="muted"
            title="No data yet"
            description="There are no cases yet."
            action={
              <Link href="/admin/cases/new" className={buttonClass("primary", "md")}>
                New case
              </Link>
            }
          />
        </div>
      </section>
    );
  }

  const rows: { label: string; value: string; basis: string }[] = [
    {
      label: "Cases created",
      value: String(metrics.casesDrafted),
      basis: `Every row of the case list. ${metrics.casesApproved} approved (including released), ${metrics.casesReleased} released. By discipline: ${byDiscipline
        .map((d) => `${d.discipline.replace("_", " ")} ${d.count}`)
        .join(", ")}`,
    },
    {
      label: "Mean authoring time",
      value: formatDuration(metrics.meanAuthoringSeconds),
      basis: "Brief saved to approval, approved cases only",
    },
    {
      label: "Approved without regeneration",
      value: formatPct(metrics.firstPassApprovalPct),
      basis: "Share of approved cases with no section regenerated",
    },
    {
      label: "Mean regenerations per case",
      value: formatNumber(metrics.meanRegensPerCase, 1),
      basis: "Approved cases only",
    },
    {
      label: "Team variants generated",
      value: String(metrics.totalVariants),
      basis: caseId ? "One per student team" : "One per student team, all cases",
    },
    {
      label: "Student page views",
      value: String(metrics.totalViews),
      basis: `${metrics.uniqueViewers} distinct device${metrics.uniqueViewers === 1 ? "" : "s"}, counted by a one-way hash`,
    },
    {
      label: "Phases opened per released case",
      value: formatNumber(metrics.meanPhaseAdvancesPerReleased, 1),
      basis: "Mean over released cases",
    },
    {
      label: "Answers saved",
      value: String(metrics.totalResponsesSaved),
      basis: "Each autosave of clarifying questions, notes or an answer counts once",
    },
    {
      label: "Mean case rating",
      value:
        quality.meanRating === null ? "n/a" : `${formatNumber(quality.meanRating, 1)} / 5`,
      basis: `${quality.ratingCount} student rating${quality.ratingCount === 1 ? "" : "s"}`,
    },
    {
      label: "Feedback flagged by students",
      value: String(quality.disputeCount),
      basis: "Times a student flagged the AI feedback for the instructor",
    },
  ];

  return (
    <section>
      <PageHeader
        title="Analytics"
        action={
          <Link
            href={`/api/admin/analytics/export${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ""}`}
            className={buttonClass("outline", "sm")}
          >
            Download CSV
          </Link>
        }
      />

      <div className="mt-6">
        <CaseFilter cases={filterOptions} value={caseId ?? null} />
      </div>

      {seeded > 0 ? (
        <p className="mt-6 max-w-3xl rounded-lg border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
          {caseId
            ? "This is an example case. Its ratings, views and answers were written by the seed script, not by students."
            : `${seeded === 1 ? "One example case is" : `${seeded} example cases are`} included in these numbers. Their ratings, views and answers were written by the seed script, not by students.`}
        </p>
      ) : null}

      <div className={cn(CARD, "mt-8 overflow-x-auto")}>
      <table className={TABLE}>
        <thead>
          <tr className={cn(THEAD_ROW, "bg-muted/40")}>
            <th scope="col" className={TH}>Measure</th>
            <th scope="col" className={cn(TH, "text-right")}>Value</th>
            <th scope="col" className={TH}>Basis</th>
          </tr>
        </thead>
        <tbody>
          {/* With one case selected, the count of cases says nothing. */}
          {(caseId ? rows.filter((r) => r.label !== "Cases created") : rows).map((r) => (
            <tr key={r.label} className={TR}>
              <th scope="row" className={cn(TD, "text-left font-medium")}>
                {r.label}
              </th>
              <td className={cn(TD, NUM, "whitespace-nowrap font-semibold")}>
                {r.value}
              </td>
              <td className={cn(TD, "min-w-[16rem] text-muted-foreground")}>{r.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <AuthoringTimeChart data={byDiscipline} oneCase={caseId !== undefined} />
        <RegenCountChart data={regenCounts} oneCase={caseId !== undefined} />
        <StudentActivityChart data={activity} oneCase={caseId !== undefined} />
        <div className="lg:col-span-2">
          <EngagementChart data={engagement} oneCase={caseId !== undefined} />
        </div>
      </div>
    </section>
  );
}
