import { PageHeader } from "@/components/ui/page-header";
import { WizardProgress } from "@/components/admin/case-wizard/wizard-progress";
import { StepInput } from "@/components/admin/case-wizard/step-input";

export const metadata = { title: "New case · PersCase" };

export default function NewCasePage() {
  return (
    <section>
      <PageHeader
        title="New case"
        description="Step 1 of 4: the brief."
        back={{ href: "/admin/cases", label: "Back to cases" }}
      />
      <div className="mt-6">
        <WizardProgress current={1} />
      </div>
      <div className="mt-8">
        <StepInput />
      </div>
    </section>
  );
}
