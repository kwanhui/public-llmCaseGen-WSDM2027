// One place for every date a person reads in the interface: day, named month,
// year, and a 24-hour time where the time matters ("2 Sep 2026, 14:18").
//
// The zone is fixed to Singapore, where the instructors using the tool teach,
// so that a page rendered on the server and the same page rendered in the
// browser print the same string. Exports meant for machines (CSV, the
// provenance record) keep ISO timestamps and do not come through here.
const ZONE = "Asia/Singapore";

// Month names are spelt here rather than taken from the runtime, because
// runtimes disagree ("Sep" or "Sept") and the server and the browser must agree.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PARTS = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: ZONE,
});

function parts(d: Date): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PARTS.formatToParts(d)) out[p.type] = p.value;
  return out;
}

function toDate(value: Date | string | number): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return "";
  const p = parts(d);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}`;
}

export function formatDateTime(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return "";
  const p = parts(d);
  return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}

// Time of day on the reader's own clock, for "saved at 14:18" on the student
// page. Only ever rendered in the browser, after an event, so it cannot
// disagree with a server render.
export function formatClockTime(value: Date | string | number): string {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}
