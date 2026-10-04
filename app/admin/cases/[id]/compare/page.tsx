import { notFound } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { PageHeader } from "@/components/ui/page-header";
import { CaseCompare } from "@/components/admin/case-compare";
import {
  comparisonViewForCase,
  loadCaseForComparison,
} from "@/lib/generation/compare-store";
import { DISCIPLINE_PACKS } from "@/lib/disciplines";
import { isSeededCase } from "@/lib/case/seeded";
import { EXAMPLE_CASE_LABEL } from "@/components/admin/status-pill";
import type { DisciplineId } from "@/lib/disciplines/types";

// The contrastive view: the same brief run through a plain LLM prompt, the
// structured path with retrieval switched off, and the case's own approved
// draft. Rendered from the cache so a seeded case opens instantly; the Re-run
// button on the client regenerates the two on-demand arms.

export const metadata = { title: "Contrastive view · PersCase" };

export default async function CaseComparePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const instructorId = (session.user as { id: string }).id;
  const { id } = await params;

  const found = await loadCaseForComparison(id, instructorId);
  if (!found) notFound();

  const view = await comparisonViewForCase(found.row);
  const pack = DISCIPLINE_PACKS[found.row.discipline as DisciplineId];

  return (
    <section>
      <PageHeader
        title="Contrastive view"
        description={`Three outputs from the same ${pack.label.toLowerCase()} brief: a plain prompt, structured generation without retrieval, and the case's own draft.`}
        back={{ href: `/admin/cases/${id}`, label: "Back to case" }}
      />
      <div className="mt-6">
        <CaseCompare
          initial={view}
          fixedBaselinesNote={
            isSeededCase(id)
              ? `${EXAMPLE_CASE_LABEL}: its baselines stay fixed so that the published readings stay reproducible. Duplicate the case to re-run them.`
              : null
          }
        />
      </div>
    </section>
  );
}
