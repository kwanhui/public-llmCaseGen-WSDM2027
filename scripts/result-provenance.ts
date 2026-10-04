// The block every result file under demo/ carries, so that a number in the
// paper can be traced to the code that produced it.
//
// The commit is read from git at write time. It reads "unknown" when the script
// runs outside a checkout, and the file then still records the date.

import { execFileSync } from "node:child_process";

export interface ResultProvenance {
  commit: string;
  // True when the working tree had uncommitted changes at write time, so a
  // reader knows the commit alone does not identify the code that ran.
  dirty: boolean;
  generatedAt: string;
  modelId?: string;
}

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function resultProvenance(modelId?: string): ResultProvenance {
  const commit = git(["rev-parse", "HEAD"]);
  const status = git(["status", "--porcelain"]);
  return {
    commit: commit ?? "unknown",
    dirty: status === null ? false : status.length > 0,
    generatedAt: new Date().toISOString(),
    ...(modelId ? { modelId } : {}),
  };
}
