// Shared class strings for the admin and student surfaces, so that cards,
// tables and pills read the same on every page as on the landing page.
import { cn } from "@/lib/utils";

// A raised surface: the card colour, a hairline border, 8 px corners.
export const CARD = "rounded-lg border bg-card text-card-foreground shadow-xs";

// Tables: hairline rows, small uppercase column headers, tabular numerals for
// numbers (add NUM to a cell).
export const TABLE = "w-full border-collapse text-sm";
export const THEAD_ROW = "border-b text-left";
export const TH =
  "px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
export const TR = "border-b align-top last:border-b-0";
export const TD = "px-3 py-3 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
export const NUM = "text-right tabular-nums";

// Pills: tonal for a status, outline for a marker, flag for a missing item.
const PILL_BASE =
  "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-4";
export const PILL_TONAL = cn(PILL_BASE, "bg-muted text-foreground");
export const PILL_OUTLINE = cn(PILL_BASE, "border border-input/80 text-muted-foreground");
export const PILL_FLAG = cn(PILL_BASE, "border border-flag/40 bg-flag/5 text-flag");
export const PILL_PRIMARY = cn(PILL_BASE, "bg-primary/10 text-primary");

// Form labels.
export const LABEL = "block text-sm font-medium";

// Notices.
export const NOTE_MUTED = "rounded-lg border bg-muted/60 px-4 py-3 text-sm text-muted-foreground";
export const NOTE_FLAG = "rounded-lg border border-flag/30 bg-flag/5 px-4 py-3 text-sm text-flag";

// An inline text link inside tables and notes.
export const LINK =
  "rounded-sm font-medium text-primary underline-offset-2 hover:underline";
