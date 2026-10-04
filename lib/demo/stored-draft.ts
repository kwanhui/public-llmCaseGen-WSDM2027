// The stored PersCase draft for the guided run's brief. When the PersCase arm
// of /api/demo/generate fails every attempt on the brief of the scripted
// preset ("Finance: liquidity", SCRIPT_DEFAULT_PRESET_ID), it returns this
// draft instead of an error, marked as stored, so that the guided run can go
// on to its later steps. The readings are taken on it afresh, against the
// notes of the request. Any other brief gets the error.
//
// The file is a read-only snapshot of the walkthrough case generated from the
// same brief (case e228508d-6ed0-4c45-bf74-fbab54445a54): its content as
// stored and the notes its generation retrieved (demo/README.md says how it
// was taken).
import stored from "@/demo/sample-outputs/walk-finance-liquidity.json";
import { PRESETS } from "@/components/demo/presets";
import { GenerationOutputSchema, type GenerationOutput } from "@/lib/generation/schema";
import type { CaseInput } from "@/lib/disciplines/types";

export interface StoredDraft {
  presetId: string;
  capturedAt: string;
  caseId: string;
  // The notes the stored draft was generated from, as the case's
  // generation_completed event records them.
  provenance: string[];
  content: GenerationOutput;
}

// Said in the response (`storedFrom`), and on the page above the draft.
export const STORED_FROM = "an earlier run of this brief";

function normalise(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

let cached: { draft: StoredDraft; objective: string; discipline: CaseInput["discipline"] } | null | undefined;

function load() {
  if (cached !== undefined) return cached;
  const preset = PRESETS.find((p) => p.id === stored.presetId);
  const content = GenerationOutputSchema.safeParse(stored.content);
  cached =
    preset && content.success
      ? {
          draft: {
            presetId: stored.presetId,
            capturedAt: stored.capturedAt,
            caseId: stored.caseId,
            provenance: stored.provenance,
            content: content.data,
          },
          objective: normalise(preset.brief.learningObjective),
          discipline: preset.brief.discipline,
        }
      : null;
  return cached;
}

// The stored draft when `brief` is the scripted preset's brief, matched on its
// learning objective (and discipline), or null.
export function storedDraftFor(brief: Pick<CaseInput, "discipline" | "learningObjective">): StoredDraft | null {
  const s = load();
  if (!s) return null;
  if (brief.discipline !== s.discipline) return null;
  return normalise(brief.learningObjective) === s.objective ? s.draft : null;
}
