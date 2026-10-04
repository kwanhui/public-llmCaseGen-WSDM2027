import { PILL_OUTLINE, PILL_PRIMARY, PILL_TONAL } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

// The one wording for a seeded example case, on every admin page.
export const EXAMPLE_CASE_LABEL = "Example case (read-only)";
export const EXAMPLE_CASE_NOTICE = "Example case (read-only). Duplicate it to edit.";
export const EXAMPLE_CASE_TITLE = "Example cases are read-only. Duplicate one to get a copy you can change.";

// "Draft" before approval (the generating and editing states included),
// "Approved", then "Released". Released implies approved, so a released case
// shows one pill, with the phase when it is known.
const LABELS: Record<string, string> = {
  draft: "Draft",
  generating: "Draft",
  editing: "Draft",
  approved: "Approved",
  released: "Released",
};

const TONES: Record<string, string> = {
  approved: PILL_PRIMARY,
  released: cn(PILL_TONAL, "bg-primary text-primary-foreground"),
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function StatusPill({
  status,
  phase,
  className,
}: {
  status: string;
  // For a released case: the phase the cohort is on, as { index, total }.
  phase?: { index: number; total: number } | null;
  className?: string;
}) {
  const label =
    status === "released" && phase && phase.index >= 1
      ? `Released, phase ${phase.index} of ${phase.total}`
      : statusLabel(status);
  return <span className={cn(TONES[status] ?? PILL_TONAL, className)}>{label}</span>;
}

export function ExamplePill({ className }: { className?: string }) {
  return <span className={cn(PILL_OUTLINE, className)}>{EXAMPLE_CASE_LABEL}</span>;
}
