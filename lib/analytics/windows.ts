// Rolling-window helpers for analytics queries.

export interface RollingWindow {
  currentStart: Date;
  currentEnd: Date;
  priorStart: Date;
  priorEnd: Date;
}

export function rollingWindow(days = 7, now: Date = new Date()): RollingWindow {
  const dayMs = 24 * 60 * 60 * 1000;
  const currentEnd = now;
  const currentStart = new Date(now.getTime() - days * dayMs);
  const priorEnd = currentStart;
  const priorStart = new Date(currentStart.getTime() - days * dayMs);
  return { currentStart, currentEnd, priorStart, priorEnd };
}

export function delta(current: number, prior: number): { abs: number; pct: number | null } {
  const abs = current - prior;
  const pct = prior === 0 ? null : (abs / prior) * 100;
  return { abs, pct };
}

export function dayBuckets(start: Date, end: Date): Date[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: Date[] = [];
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  for (let t = startDay.getTime(); t <= endDay.getTime(); t += dayMs) {
    buckets.push(new Date(t));
  }
  return buckets;
}
