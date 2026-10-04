// The "What differs at this step" panel under the two demo columns.
//
// Export (kept stable for components/demo/demo-client.tsx):
//   DifferencesPanel({ cards, step, title? })
//     cards  from computeDifferences() in lib/demo/differences.ts
//     step   optional, "retrieval" | "draft" | "regenerate" | "variant" | "student"; sets
//            id="differences-{step}" on the root, which the guided run scrolls
//            to. When omitted it is read from the cards (stepOfCards).
//     title  heading text, "What differs at this step" by default
//     compact  one card per row, for a panel inside a column
//
// Renders nothing when there are no cards. Neutral styling throughout: no
// colour that could read as a score for either column.
import { stepOfCards, type DifferenceCard, type DifferenceStep } from "@/lib/demo/differences";

export function DifferencesPanel({
  cards,
  step,
  title = "What differs at this step",
  compact = false,
}: {
  cards: DifferenceCard[];
  step?: DifferenceStep;
  title?: string;
  compact?: boolean;
}) {
  if (cards.length === 0) return null;
  const s = step ?? stepOfCards(cards);
  return (
    // Focusable from script only: the page moves focus here when the step's
    // results arrive.
    <section
      id={s ? `differences-${s}` : undefined}
      aria-label={title}
      tabIndex={-1}
      className={
        compact
          ? "scroll-mt-4 rounded-md border bg-card p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "scroll-mt-4 rounded-lg border bg-card p-4 text-card-foreground shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
      }
    >
      <h2 className={compact ? "text-sm font-semibold" : "text-lg font-semibold"}>{title}</h2>
      <ul
        className={
          compact ? "mt-3 grid gap-3" : "mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {cards.map((c) => (
          <li
            key={c.id}
            className={
              compact
                ? "rounded-md bg-muted/60 p-3 leading-relaxed"
                : "rounded-md border bg-background p-4 leading-relaxed"
            }
          >
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              {c.title}
            </p>
            <p className={compact ? "mt-1.5 text-[15px]" : "mt-1.5 text-base"}>{c.sentence}</p>
            {c.detail && c.detail.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {c.detail.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
