"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { CARD, LABEL, NOTE_FLAG } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

interface Props {
  caseId: string;
  discipline: string;
  // Once team variants exist, copying their links is the next action, so
  // generating more is a secondary button.
  hasVariants?: boolean;
}

interface Override {
  displayName?: string;
  industry?: string;
  role?: string;
  teamSize?: number;
}

interface TeamResult {
  index: number;
  teamName: string;
  status: "created" | "failed";
  id?: string;
  token?: string;
  conceptsMissing?: string[];
  message?: string;
}

// Example team profiles, one set per discipline, so the placeholder fits the case.
const CSV_EXAMPLES: Record<string, string> = {
  finance:
    "Team A, retail banking, junior analyst, 4\nTeam B, corporate treasury, treasury analyst, 5",
  marketing:
    "Team A, packaged food retail, assistant brand manager, 4\nTeam B, telecommunications, product marketing executive, 5",
  social_work:
    "Team A, family service centre, case worker, 4\nTeam B, hospital medical social work, medical social worker, 5",
};

function parseCsv(text: string): Override[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const overrides: Override[] = [];
  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length === 0 || cols.every((c) => !c)) continue;
    const size = cols[3] ? parseInt(cols[3], 10) : undefined;
    overrides.push({
      displayName: cols[0] || undefined,
      industry: cols[1] || undefined,
      role: cols[2] || undefined,
      teamSize: Number.isFinite(size) ? size : undefined,
    });
  }
  return overrides;
}

export function SpawnVariantsForm({ caseId, discipline, hasVariants = false }: Props) {
  const CSV_HINT = CSV_EXAMPLES[discipline] ?? CSV_EXAMPLES.finance;
  const router = useRouter();
  // v2: the CSV lost its priorKnowledge column, so a form saved under the old
  // key would read the team size from the wrong place.
  const storageKey = `perscase.variant-form.v2.${caseId}`;

  const [count, setCount] = useState(3);
  const [teamSize, setTeamSize] = useState(4);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<TeamResult[] | null>(null);
  // The overrides the last run used, so a failed team can be retried with the
  // same profile rather than with a fresh guess.
  const lastOverrides = useRef<Override[] | null>(null);

  // The form's contents survive a reload and a run. A generation run can take
  // a while, and an instructor who leaves the page should not have to retype
  // a CSV of teams.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        count?: number;
        teamSize?: number;
        csv?: string;
      };
      // Restored after mount rather than in the state initialiser: local
      // storage does not exist during server rendering, and reading it in the
      // initialiser would make the first client render disagree with the
      // server's.
      /* eslint-disable react-hooks/set-state-in-effect */
      if (typeof parsed.count === "number") setCount(parsed.count);
      if (typeof parsed.teamSize === "number") setTeamSize(parsed.teamSize);
      if (typeof parsed.csv === "string") setCsv(parsed.csv);
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      // A browser that refuses local storage just starts from the defaults.
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ count, teamSize, csv }),
      );
    } catch {
      // ignore
    }
  }, [storageKey, count, teamSize, csv]);

  const plannedCount = csv.trim() ? parseCsv(csv).length : count;

  async function run(body: {
    count?: number;
    overrides?: Override[];
    teamSize: number;
  }): Promise<TeamResult[] | null> {
    const res = await fetch(`/api/admin/cases/${caseId}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
    }
    return (data.results ?? null) as TeamResult[] | null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResults(null);
    setBusy(true);
    try {
      const overrides = csv.trim() ? parseCsv(csv) : [];
      const body: { count?: number; overrides?: Override[]; teamSize: number } = {
        teamSize,
      };
      if (overrides.length > 0) body.overrides = overrides;
      else body.count = count;
      lastOverrides.current = overrides.length > 0 ? overrides : null;
      const teamResults = await run(body);
      // Always end with an outcome on screen, even if the server answered with
      // a shape this form did not expect.
      setResults(
        teamResults ?? [
          {
            index: 0,
            teamName: "This run",
            status: "failed",
            message: "The run finished but returned no per-team result. Reload to see which team variants exist.",
          },
        ],
      );
      router.refresh();
    } catch (e) {
      setErr(
        e instanceof TypeError
          ? "The request did not reach the server. No team variants were generated."
          : e instanceof Error
            ? e.message
            : "The run failed. No team variants were generated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryFailed() {
    if (!results) return;
    const failed = results.filter((r) => r.status === "failed");
    if (failed.length === 0) return;
    setErr(null);
    setBusy(true);
    try {
      const body: { count?: number; overrides?: Override[]; teamSize: number } = {
        teamSize,
      };
      if (lastOverrides.current) {
        body.overrides = failed.map(
          (r) => lastOverrides.current?.[r.index] ?? {},
        );
      } else {
        body.count = failed.length;
      }
      const retried = await run(body);
      const kept = results.filter((r) => r.status === "created");
      setResults([
        ...kept,
        ...(retried ?? []).map((r, i) => ({
          ...r,
          teamName: failed[i]?.teamName ?? r.teamName,
        })),
      ]);
      router.refresh();
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "The retry failed. Nothing further was created.",
      );
    } finally {
      setBusy(false);
    }
  }

  const failedCount = results?.filter((r) => r.status === "failed").length ?? 0;

  return (
    <form onSubmit={submit} className={cn(CARD, "space-y-5 px-4 py-5 sm:px-5")}>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <div>
          <label htmlFor="vcount" className={LABEL}>
            Number of teams
          </label>
          <Input
            id="vcount"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 1)}
            className="mt-1.5 w-24 tabular-nums"
            disabled={busy}
          />
          <p className="mt-1 text-sm text-muted-foreground">Ignored if a CSV is given.</p>
        </div>
        <div>
          <label htmlFor="vteamsize" className={LABEL}>
            Students per team
          </label>
          <Input
            id="vteamsize"
            type="number"
            min={1}
            max={12}
            value={teamSize}
            onChange={(e) => setTeamSize(Number(e.target.value) || 1)}
            className="mt-1.5 w-24 tabular-nums"
            disabled={busy}
          />
        </div>
      </div>
      <div>
        <label htmlFor="vcsv" className={LABEL}>
          Team profiles (CSV, optional)
        </label>
        <p className="mt-1 text-sm text-muted-foreground">
          One team per line:{" "}
          <span className="font-mono">teamName, industry, role, teamSize</span>. A blank
          column takes the case&apos;s value. The team name labels the link and is
          not written into the case.{" "}
          <button
            type="button"
            onClick={() => setCsv(CSV_HINT)}
            disabled={busy}
            className="rounded-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            Use example
          </button>
        </p>
        <Textarea
          id="vcsv"
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          disabled={busy}
          className="mt-2 font-mono text-xs"
          placeholder={CSV_HINT}
        />
      </div>
      {err ? (
        <div role="alert" className={NOTE_FLAG}>
          {err}
        </div>
      ) : null}
      {results ? (
        <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
          <p className="font-medium">
            {results.filter((r) => r.status === "created").length} of {results.length}{" "}
            team variant{results.length === 1 ? "" : "s"} generated.
          </p>
          <ul className="mt-2 space-y-1">
            {results.map((r, i) => (
              <li key={`${r.index}-${i}`} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="shrink-0 font-medium text-foreground sm:w-40">
                  {r.teamName}
                </span>
                {r.status === "created" ? (
                  <span className="text-muted-foreground">
                    generated
                    {r.conceptsMissing && r.conceptsMissing.length > 0
                      ? ` · must-cover concepts missing: ${r.conceptsMissing.join(", ")}`
                      : " · all must-cover concepts present"}
                  </span>
                ) : (
                  <span className="text-flag">{r.message ?? "failed"}</span>
                )}
              </li>
            ))}
          </ul>
          {failedCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={retryFailed}
              loading={busy}
              disabled={busy}
            >
              Retry {failedCount} failed team{failedCount === 1 ? "" : "s"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm text-muted-foreground">
          {plannedCount} model call{plannedCount === 1 ? "" : "s"} of 10 to 40 seconds each,
          up to four in parallel.
        </p>
        <Button
          type="submit"
          variant={hasVariants ? "outline" : "primary"}
          loading={busy}
          disabled={busy}
        >
          {busy ? `Generating ${plannedCount}…` : "Generate team variants"}
        </Button>
      </div>
    </form>
  );
}
