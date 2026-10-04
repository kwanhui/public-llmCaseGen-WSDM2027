import Link from "next/link";
import { eq, desc, count } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { cases, caseVariants, studentResponses } from "@/lib/db/schema";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CaseActions } from "@/components/admin/case-actions";
import { ExamplePill, StatusPill } from "@/components/admin/status-pill";
import { formatDate } from "@/lib/format-date";
import { isSeededCase } from "@/lib/case/seeded";
import { CARD, TABLE, TD, TH, THEAD_ROW, TR } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

const DISCIPLINE_LABELS: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  social_work: "Social work",
};

export const metadata = { title: "Cases · PersCase" };

export default async function CasesPage() {
  const session = await auth();
  if (!session?.user) return null;
  const instructorId = (session.user as { id: string }).id;

  let myCases: Array<{
    id: string;
    discipline: string;
    learningObjective: string;
    status: string;
    createdAt: Date;
  }> = [];
  try {
    myCases = await db
      .select({
        id: cases.id,
        discipline: cases.discipline,
        learningObjective: cases.learningObjective,
        status: cases.status,
        createdAt: cases.createdAt,
      })
      .from(cases)
      .where(eq(cases.instructorId, instructorId))
      .orderBy(desc(cases.createdAt));
  } catch {
    // No database: render the empty state.
  }

  // Team links and saved answers per case, so that Delete can say what goes
  // with the case before it is removed.
  const linkCounts = new Map<string, number>();
  const answerCounts = new Map<string, number>();
  if (myCases.length > 0) {
    try {
      const [links, answers] = await Promise.all([
        db
          .select({ caseId: caseVariants.caseId, n: count(caseVariants.id) })
          .from(caseVariants)
          .innerJoin(cases, eq(caseVariants.caseId, cases.id))
          .where(eq(cases.instructorId, instructorId))
          .groupBy(caseVariants.caseId),
        db
          .select({ caseId: caseVariants.caseId, n: count(studentResponses.id) })
          .from(studentResponses)
          .innerJoin(caseVariants, eq(studentResponses.variantId, caseVariants.id))
          .innerJoin(cases, eq(caseVariants.caseId, cases.id))
          .where(eq(cases.instructorId, instructorId))
          .groupBy(caseVariants.caseId),
      ]);
      for (const r of links) linkCounts.set(r.caseId, Number(r.n));
      for (const r of answers) answerCounts.set(r.caseId, Number(r.n));
    } catch {
      // Counts unavailable: the delete confirmation says less.
    }
  }

  return (
    <section>
      <PageHeader
        title="Your cases"
        description="Each case starts as a draft from your brief. After approval, you generate a team variant for each team."
        action={
          myCases.length > 0 ? (
            <div className="flex items-center gap-2">
              <Link href="/admin/analytics" className={buttonClass("outline", "md")}>
                Analytics
              </Link>
              <Link href="/admin/cases/new" className={buttonClass("primary", "md")}>
                New case
              </Link>
            </div>
          ) : null
        }
      />

      {myCases.length === 0 ? (
        <EmptyState
          variant="muted"
          className="mt-8"
          title="No cases yet"
          description="Start with a brief: a discipline, a learning objective and a learner profile."
          action={
            <Link href="/admin/cases/new" className={buttonClass("primary", "md")}>
              New case
            </Link>
          }
        />
      ) : (
        <>
        {/* Below md each case is a card: the objective at full width, then the
            discipline and date, then the status and Actions on one line. At phone
            width the table squeezed the objective into a column a word wide. */}
        <ul className="mt-8 space-y-3 md:hidden">
          {myCases.map((c) => {
            const seeded = isSeededCase(c.id);
            return (
              <li key={c.id} className={cn(CARD, "px-4 py-3")}>
                <Link
                  href={`/admin/cases/${c.id}`}
                  className="line-clamp-3 rounded-sm font-medium underline-offset-2 [overflow-wrap:anywhere] hover:text-primary hover:underline"
                >
                  {c.learningObjective}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">
                  {DISCIPLINE_LABELS[c.discipline] ?? c.discipline} · {formatDate(c.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                    <StatusPill status={c.status} />
                    {seeded ? <ExamplePill /> : null}
                  </div>
                  <CaseActions
                    id={c.id}
                    seeded={seeded}
                    teamLinks={linkCounts.get(c.id) ?? 0}
                    savedAnswers={answerCounts.get(c.id) ?? 0}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <div className={cn(CARD, "mt-8 hidden md:block")}>
          <table className={TABLE}>
            <thead>
              <tr className={THEAD_ROW}>
                <th scope="col" className={TH}>
                  Case
                </th>
                <th scope="col" className={TH}>
                  Status
                </th>
                <th scope="col" className={TH}>
                  Created
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {myCases.map((c) => {
                const seeded = isSeededCase(c.id);
                return (
                  <tr key={c.id} className={cn(TR, "transition-colors hover:bg-muted/40")}>
                    <td className={cn(TD, "min-w-0")}>
                      <Link
                        href={`/admin/cases/${c.id}`}
                        className="rounded-sm font-medium underline-offset-2 [overflow-wrap:anywhere] hover:text-primary hover:underline"
                      >
                        {c.learningObjective}
                      </Link>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {DISCIPLINE_LABELS[c.discipline] ?? c.discipline}
                      </span>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusPill status={c.status} />
                        {seeded ? <ExamplePill /> : null}
                      </div>
                    </td>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums text-muted-foreground")}>
                      {formatDate(c.createdAt)}
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <CaseActions
                        id={c.id}
                        seeded={seeded}
                        teamLinks={linkCounts.get(c.id) ?? 0}
                        savedAnswers={answerCounts.get(c.id) ?? 0}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}
