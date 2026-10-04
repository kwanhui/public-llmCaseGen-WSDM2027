// The guided run of the public demo: a fixed list of steps, each of which
// switches to its scene, points at the control it uses, runs, and then scrolls
// to what it produced. Plain TypeScript, so the order of events can be read
// here rather than inside the page's state.

export type GuidedPace = "play" | "step";

export interface GuidedStepResult {
  ok: boolean;
  // Why the step did not complete, as the rest of a sentence that starts
  // "Step n stopped: ".
  error?: string;
  // How many difference cards the step produced; sets the pause in play mode.
  cardCount?: number;
}

export interface GuidedStep<S extends string = string> {
  id: string;
  // A function when the title depends on what earlier steps produced; it is
  // read once, when the step is reached.
  title: string | (() => string);
  sceneId: S;
  // The value of the control's data-control attribute and of its element id
  // when the page scrolls to it.
  controlId: string;
  action: () => Promise<GuidedStepResult>;
  // The element to scroll to once the action has succeeded.
  resultId: string;
  // A conditional step: asked when the step is reached, and when it returns
  // true the step is passed over, with no pause for reading and no Next (only
  // `skipNotice`, when set), and its number is reported in the banner's
  // `skipped`.
  skip?: () => boolean;
  // Shown in the banner, in place of "Step n of m: title", for `ms` when the
  // step is passed over, so that the visitor sees why before the run moves on.
  // A function when the text depends on what earlier steps produced.
  skipNotice?: { caption: string | (() => string); ms: number };
}

export interface GuidedBanner {
  // 1-based.
  step: number;
  total: number;
  title: string;
  waitingForNext: boolean;
  // 1-based numbers of the conditional steps passed over as not needed.
  skipped: number[];
  // The whole caption, when it is not "Step n of m: title": a passed-over
  // step's notice, "Next: title" while step mode waits between steps, or
  // "Step n stopped: why" when the step failed.
  caption?: string;
  // The step failed: the banner then offers "Retry this step" and "Stop"
  // instead of Next and "Stop after this step".
  failed?: boolean;
}

export interface GuidedHooks<S extends string = string> {
  setScene: (sceneId: S) => void;
  setBanner: (banner: GuidedBanner | null) => void;
  spotlight: (controlId: string, ms: number) => void;
  scrollTo: (id: string, block: ScrollLogicalPosition) => void;
  // Resolves when the visitor presses Next in step mode. The page also
  // resolves it when the run is stopped, so that a waiting run can end.
  waitForNext: () => Promise<void>;
  // Resolves with the visitor's choice after a step failed: run the same step
  // again (its units are charged again), or end the run. The page also
  // resolves it with "stop" when the run is stopped.
  waitForRetry: () => Promise<"retry" | "stop">;
  isStopped: () => boolean;
}

export type GuidedOutcome = "done" | "stopped" | "failed";

export const SPOTLIGHT_MS = 1200;
const PLAY_BASE_MS = 4000;
const PLAY_PER_CARD_MS = 1000;
const PLAY_MAX_MS = 10000;
const SLEEP_TICK_MS = 200;

// The pause after a step in play mode: longer when there is more to read.
export function playPauseMs(cardCount = 0): number {
  return Math.min(PLAY_MAX_MS, PLAY_BASE_MS + PLAY_PER_CARD_MS * Math.max(0, cardCount));
}

function titleOf(step: GuidedStep<string>): string {
  return typeof step.title === "function" ? step.title() : step.title;
}

function capitalised(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

export function createGuidedRun<S extends string>({
  steps,
  pace,
  hooks,
}: {
  steps: GuidedStep<S>[];
  pace: GuidedPace;
  hooks: GuidedHooks<S>;
}): { run: () => Promise<GuidedOutcome> } {
  // Sleeps in short ticks, so that a stop ends the pause early. Returns false
  // when the run was stopped.
  async function sleep(ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (hooks.isStopped()) return false;
      await new Promise((r) => setTimeout(r, Math.min(SLEEP_TICK_MS, end - Date.now())));
    }
    return !hooks.isStopped();
  }

  async function run(): Promise<GuidedOutcome> {
    const total = steps.length;
    const skipped: number[] = [];

    // The step that will run after step `from - 1`, and the conditional steps
    // before it that will be passed over. Asked once a step has finished, so
    // that a title or a skip rule that reads earlier results sees them.
    function coming(from: number): { index: number; title: string; passedOver: number[] } | null {
      const passedOver: number[] = [];
      for (let j = from; j < total; j++) {
        if (steps[j].skip?.()) {
          passedOver.push(j + 1);
          continue;
        }
        return { index: j, title: titleOf(steps[j]), passedOver };
      }
      return null;
    }

    try {
      for (let i = 0; i < total; i++) {
        const step = steps[i];
        if (hooks.isStopped()) return "stopped";
        if (step.skip?.()) {
          skipped.push(i + 1);
          if (step.skipNotice) {
            const title = titleOf(step);
            hooks.setBanner({
              step: i + 1,
              total,
              title,
              waitingForNext: false,
              skipped: [...skipped],
              caption:
                typeof step.skipNotice.caption === "function"
                  ? step.skipNotice.caption()
                  : step.skipNotice.caption,
            });
            if (!(await sleep(step.skipNotice.ms))) return "stopped";
          }
          continue;
        }
        const title = titleOf(step);
        const banner = (waitingForNext: boolean): GuidedBanner => ({
          step: i + 1,
          total,
          title,
          waitingForNext,
          skipped: [...skipped],
        });

        hooks.setScene(step.sceneId);
        await nextFrame();
        if (hooks.isStopped()) return "stopped";
        hooks.scrollTo(step.controlId, "center");
        hooks.setBanner(banner(false));
        hooks.spotlight(step.controlId, SPOTLIGHT_MS);

        // In step mode the first step also waits for Next, so that nothing is
        // sent to a model until the visitor asks for it. Every later step
        // starts from the Next pressed after the step before it.
        if (pace === "step" && i === 0) {
          hooks.setBanner(banner(true));
          await hooks.waitForNext();
          if (hooks.isStopped()) return "stopped";
          hooks.setBanner(banner(false));
          // The visitor may have scrolled away while reading; bring the
          // control back before pointing at it.
          hooks.scrollTo(step.controlId, "center");
          hooks.spotlight(step.controlId, SPOTLIGHT_MS);
        }

        let result = await step.action();
        // A failed step keeps the banner, says why the step stopped, and waits
        // for "Retry this step" or "Stop". A retry runs the same step again
        // from its control, and the run goes on from there.
        while (!result.ok) {
          if (hooks.isStopped()) return "stopped";
          hooks.setBanner({
            ...banner(false),
            waitingForNext: true,
            failed: true,
            caption: `Step ${i + 1} stopped: ${result.error ?? "this step did not complete."}`,
          });
          const choice = await hooks.waitForRetry();
          if (choice === "stop" || hooks.isStopped()) return "failed";
          hooks.setBanner(banner(false));
          hooks.scrollTo(step.controlId, "center");
          hooks.spotlight(step.controlId, SPOTLIGHT_MS);
          result = await step.action();
        }
        hooks.scrollTo(step.resultId, "start");
        if (hooks.isStopped()) return "stopped";
        if (i === total - 1) break;

        if (pace === "play") {
          if (!(await sleep(playPauseMs(result.cardCount)))) return "stopped";
        } else {
          // While it waits, the banner names the step that Next starts, and
          // its discs show that step as the current one.
          const c = coming(i + 1);
          hooks.setBanner(
            c
              ? {
                  step: c.index + 1,
                  total,
                  title: c.title,
                  waitingForNext: true,
                  skipped: [...skipped, ...c.passedOver],
                  caption: `Next: ${capitalised(c.title)}`,
                }
              : banner(true),
          );
          await hooks.waitForNext();
          if (hooks.isStopped()) return "stopped";
        }
      }
      return "done";
    } finally {
      hooks.setBanner(null);
    }
  }

  return { run };
}
