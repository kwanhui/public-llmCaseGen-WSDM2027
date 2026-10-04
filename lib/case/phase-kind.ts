import type { PhaseDefinition } from "@/lib/disciplines/types";

// Whether a phase asks the student to reflect rather than to analyse. The
// student page leaves the level badge off a reflection, where it would read as
// a mark for the person rather than for the work. The test reads the phase's id
// and label from the discipline pack (for example `sw-reflection`), which an
// instructor rewording the student prompt does not change.
export function isReflectionPhase(
  phase: Pick<PhaseDefinition, "id" | "label"> | null | undefined,
): boolean {
  if (!phase) return false;
  return /reflect/i.test(phase.id) || /reflect/i.test(phase.label);
}
