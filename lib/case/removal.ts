import { count, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { caseEvents, caseVariants, studentResponses } from "@/lib/db/schema";

// What deleting a case takes with it. The foreign keys cascade from cases to
// case_variants, case_events and case_comparisons, and from case_variants to
// student_responses, so one delete of the case row removes all of these. The
// case page calls this on the server before it asks the instructor to confirm,
// so that the confirmation can say how many team links stop working and how
// many saved answers go with them; the DELETE route calls it again and returns
// the counts it removed.
export interface CaseRemovalSummary {
  variants: number; // team links that stop working
  responses: number; // saved student answers, across all team links
  events: number; // analytics events recorded for the case
}

// Does not check ownership: callers load the case for the signed-in instructor
// first and pass only an id they may see.
export async function caseRemovalSummary(caseId: string): Promise<CaseRemovalSummary> {
  const [[variants], [responses], [events]] = await Promise.all([
    db
      .select({ cnt: count(caseVariants.id) })
      .from(caseVariants)
      .where(eq(caseVariants.caseId, caseId)),
    db
      .select({ cnt: count(studentResponses.id) })
      .from(studentResponses)
      .innerJoin(caseVariants, eq(studentResponses.variantId, caseVariants.id))
      .where(eq(caseVariants.caseId, caseId)),
    db
      .select({ cnt: count(caseEvents.id) })
      .from(caseEvents)
      .where(eq(caseEvents.caseId, caseId)),
  ]);
  return {
    variants: variants?.cnt ?? 0,
    responses: responses?.cnt ?? 0,
    events: events?.cnt ?? 0,
  };
}
