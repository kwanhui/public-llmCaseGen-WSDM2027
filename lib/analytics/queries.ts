import { eq, sql, and, gte, lte, count, avg, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cases, caseVariants, caseEvents } from "@/lib/db/schema";
import { rollingWindow } from "./windows";

// Every function below takes an optional `caseId` as its last parameter. When
// it is given, each measure and chart series is restricted to that one case
// (still only if the instructor owns it; another instructor's id yields zeros
// rather than their data). When it is omitted, the numbers cover all of the
// instructor's cases, as before.
function ownedCases(instructorId: string, caseId?: string) {
  return and(
    eq(cases.instructorId, instructorId),
    caseId ? eq(cases.id, caseId) : undefined,
  );
}

// Cases inserted by the demonstration seed script carry a "seed-" id prefix.
// Their ratings, views and responses are not from students, so the dashboard
// says when they are part of the numbers on the page.
export async function seededCaseCount(
  instructorId: string,
  caseId?: string,
): Promise<number> {
  const [row] = await db
    .select({ cnt: count(cases.id) })
    .from(cases)
    .where(and(ownedCases(instructorId, caseId), like(cases.id, "seed-%")));
  return row?.cnt ?? 0;
}

export interface TopLineMetrics {
  casesDrafted: number;
  casesApproved: number;
  casesReleased: number;
  meanAuthoringSeconds: number | null;
  totalVariants: number;
  totalViews: number;
  uniqueViewers: number;
  firstPassApprovalPct: number | null;
  meanRegensPerCase: number | null;
  meanPhaseAdvancesPerReleased: number | null;
  totalResponsesSaved: number;
}

export async function topLineMetrics(
  instructorId: string,
  caseId?: string,
): Promise<TopLineMetrics> {
  const [casesAgg] = await db
    .select({
      drafted: count(cases.id),
      approved: sql<number>`SUM(CASE WHEN ${cases.status} IN ('approved','released') THEN 1 ELSE 0 END)::int`,
      released: sql<number>`SUM(CASE WHEN ${cases.status} = 'released' THEN 1 ELSE 0 END)::int`,
      meanAuth: sql<
        number | null
      >`AVG(${cases.authoringSecondsLogged}) FILTER (WHERE ${cases.authoringSecondsLogged} IS NOT NULL)::float8`,
      meanRegens: sql<
        number | null
      >`AVG(${cases.regenerationCount}) FILTER (WHERE ${cases.status} IN ('approved','released'))::float8`,
      firstPass: sql<
        number | null
      >`(SUM(CASE WHEN ${cases.status} IN ('approved','released') AND ${cases.regenerationCount} = 0 THEN 1 ELSE 0 END)::float8 / NULLIF(SUM(CASE WHEN ${cases.status} IN ('approved','released') THEN 1 ELSE 0 END), 0)) * 100`,
    })
    .from(cases)
    .where(ownedCases(instructorId, caseId));

  const [variantsAgg] = await db
    .select({
      total: count(caseVariants.id),
      views: sql<number>`COALESCE(SUM(${caseVariants.viewCount}), 0)::int`,
    })
    .from(caseVariants)
    .innerJoin(cases, eq(caseVariants.caseId, cases.id))
    .where(ownedCases(instructorId, caseId));

  const [viewerAgg] = await db
    .select({
      uniqueViewers: sql<number>`COUNT(DISTINCT (${caseEvents.metadata}->>'viewerHash'))::int`,
      totalResponses: sql<number>`SUM(CASE WHEN ${caseEvents.eventType} = 'response_saved' THEN 1 ELSE 0 END)::int`,
      phaseAdvances: sql<number>`SUM(CASE WHEN ${caseEvents.eventType} = 'phase_advanced' THEN 1 ELSE 0 END)::int`,
    })
    .from(caseEvents)
    .innerJoin(cases, eq(caseEvents.caseId, cases.id))
    .where(ownedCases(instructorId, caseId));

  const releasedCount = casesAgg.released ?? 0;
  return {
    casesDrafted: casesAgg.drafted,
    casesApproved: casesAgg.approved ?? 0,
    casesReleased: releasedCount,
    meanAuthoringSeconds: casesAgg.meanAuth,
    totalVariants: variantsAgg.total,
    totalViews: variantsAgg.views,
    uniqueViewers: viewerAgg.uniqueViewers ?? 0,
    firstPassApprovalPct: casesAgg.firstPass,
    meanRegensPerCase: casesAgg.meanRegens,
    meanPhaseAdvancesPerReleased:
      releasedCount === 0 ? null : (viewerAgg.phaseAdvances ?? 0) / releasedCount,
    totalResponsesSaved: viewerAgg.totalResponses ?? 0,
  };
}

export interface DisciplineCount {
  discipline: string;
  count: number;
  meanAuthoringMinutes: number | null;
}

export async function casesByDiscipline(
  instructorId: string,
  caseId?: string,
): Promise<DisciplineCount[]> {
  const rows = await db
    .select({
      discipline: cases.discipline,
      cnt: count(cases.id),
      meanSec: avg(cases.authoringSecondsLogged),
    })
    .from(cases)
    .where(ownedCases(instructorId, caseId))
    .groupBy(cases.discipline);
  return rows.map((r) => ({
    discipline: r.discipline,
    count: r.cnt,
    meanAuthoringMinutes:
      r.meanSec === null || r.meanSec === undefined ? null : Number(r.meanSec) / 60,
  }));
}

export interface SectionRegenCount {
  section: string;
  count: number;
}

export async function regenerationCountsBySection(
  instructorId: string,
  caseId?: string,
): Promise<SectionRegenCount[]> {
  const rows = await db
    .select({
      section: sql<string>`${caseEvents.metadata}->>'section'`,
      cnt: count(caseEvents.id),
    })
    .from(caseEvents)
    .innerJoin(cases, eq(caseEvents.caseId, cases.id))
    .where(
      and(
        ownedCases(instructorId, caseId),
        eq(caseEvents.eventType, "section_regenerated"),
      ),
    )
    .groupBy(sql`${caseEvents.metadata}->>'section'`);
  return rows
    .filter((r) => r.section)
    .map((r) => ({ section: r.section as string, count: r.cnt }));
}

export interface DailyViewPoint {
  day: string; // YYYY-MM-DD
  views: number;
  responsesSaved: number;
}

// The last `days` calendar days, ending today, as YYYY-MM-DD in UTC. Matching
// UTC keeps these keys aligned with the stored ISO timestamps the query buckets
// on, so the chart plots exactly the number of days its title claims.
function utcDayKeys(days: number, now: Date = new Date()): string[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(today - i * dayMs).toISOString().slice(0, 10));
  }
  return keys;
}

export async function studentActivityOverTime(
  instructorId: string,
  days = 7,
  caseId?: string,
): Promise<DailyViewPoint[]> {
  const win = rollingWindow(days);
  const rows = await db
    .select({
      day: sql<string>`SUBSTRING(${caseEvents.timestampIso}, 1, 10)`,
      eventType: caseEvents.eventType,
      cnt: count(caseEvents.id),
    })
    .from(caseEvents)
    .innerJoin(cases, eq(caseEvents.caseId, cases.id))
    .where(
      and(
        ownedCases(instructorId, caseId),
        gte(caseEvents.timestampIso, win.currentStart.toISOString()),
        lte(caseEvents.timestampIso, win.currentEnd.toISOString()),
        sql`${caseEvents.eventType} IN ('variant_viewed','response_saved')`,
      ),
    )
    .groupBy(sql`SUBSTRING(${caseEvents.timestampIso}, 1, 10)`, caseEvents.eventType);

  const map = new Map<string, { views: number; responses: number }>();
  for (const key of utcDayKeys(days)) {
    map.set(key, { views: 0, responses: 0 });
  }
  for (const r of rows) {
    // A row outside the window (the query bounds are times, not whole days) is
    // dropped rather than added as an extra date on a chart of fixed length.
    const m = map.get(r.day);
    if (!m) continue;
    if (r.eventType === "variant_viewed") m.views = r.cnt;
    else if (r.eventType === "response_saved") m.responses = r.cnt;
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, v]) => ({ day, views: v.views, responsesSaved: v.responses }));
}

export interface QualityFeedback {
  ratingCount: number;
  meanRating: number | null;
  disputeCount: number;
}

// Aggregate student-reported quality signals across all of an instructor's
// cases: average of the 1-5 case ratings students submit, and the number of
// times automated formative feedback was flagged as off. Gives a programme lead
// a coarse quality read without opening every case.
export async function qualityFeedback(
  instructorId: string,
  caseId?: string,
): Promise<QualityFeedback> {
  const [agg] = await db
    .select({
      ratingCount: sql<number>`SUM(CASE WHEN ${caseEvents.eventType} = 'quality_rated' THEN 1 ELSE 0 END)::int`,
      meanRating: sql<
        number | null
      >`AVG((${caseEvents.metadata}->>'rating')::float8) FILTER (WHERE ${caseEvents.eventType} = 'quality_rated')`,
      disputeCount: sql<number>`SUM(CASE WHEN ${caseEvents.eventType} = 'feedback_disputed' THEN 1 ELSE 0 END)::int`,
    })
    .from(caseEvents)
    .innerJoin(cases, eq(caseEvents.caseId, cases.id))
    .where(ownedCases(instructorId, caseId));
  return {
    ratingCount: agg?.ratingCount ?? 0,
    meanRating: agg?.meanRating ?? null,
    disputeCount: agg?.disputeCount ?? 0,
  };
}

export interface ResponsesByDiscipline {
  discipline: string;
  responses: number;
  views: number;
}

export async function engagementByDiscipline(
  instructorId: string,
  caseId?: string,
): Promise<ResponsesByDiscipline[]> {
  const rows = await db
    .select({
      discipline: cases.discipline,
      eventType: caseEvents.eventType,
      cnt: count(caseEvents.id),
    })
    .from(caseEvents)
    .innerJoin(cases, eq(caseEvents.caseId, cases.id))
    .where(
      and(
        ownedCases(instructorId, caseId),
        sql`${caseEvents.eventType} IN ('variant_viewed','response_saved')`,
      ),
    )
    .groupBy(cases.discipline, caseEvents.eventType);

  const map = new Map<string, { responses: number; views: number }>();
  for (const r of rows) {
    if (!map.has(r.discipline)) map.set(r.discipline, { responses: 0, views: 0 });
    const m = map.get(r.discipline)!;
    if (r.eventType === "variant_viewed") m.views = r.cnt;
    else m.responses = r.cnt;
  }
  return Array.from(map.entries()).map(([discipline, v]) => ({
    discipline,
    ...v,
  }));
}
