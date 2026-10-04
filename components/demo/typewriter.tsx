"use client";

// Adapted from components/chat/typewriter.tsx of SAGE
// (https://github.com/kwanhui/public-llmLearnFair-CIKM2026).

import { useEffect, useState, type ReactNode } from "react";

interface Props {
  text: string;
  // Milliseconds per character. The default reveals about 400 characters a
  // second.
  msPerChar?: number;
  // How the full text is shown once the reveal ends. The partial text is shown
  // as it arrives, with line breaks kept; the finished text can then be
  // rendered properly (as markdown, with marks) without the reveal having to
  // parse half a document.
  renderDone?: (text: string) => ReactNode;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// The parent remounts this component (with a key per result) when a new result
// arrives, so the initial state is always right for the text.
export function Typewriter({ text, msPerChar = 2.5, renderDone }: Props) {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0));
  const done = count >= text.length;

  // One update per animation frame, revealing however many characters the
  // elapsed time allows, rather than one timer per character.
  useEffect(() => {
    if (done) return;
    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const next = Math.min(text.length, Math.floor((now - startedAt) / msPerChar));
      setCount((c) => Math.max(c, next));
      if (next < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [done, text.length, msPerChar]);

  if (done) {
    return <>{renderDone ? renderDone(text) : <p className="whitespace-pre-wrap">{text}</p>}</>;
  }

  // While the reveal runs, assistive technology gets the finished text, rendered
  // as it will be at the end; the partial text and its cursor are hidden from it.
  return (
    <div>
      <button
        type="button"
        onClick={() => setCount(text.length)}
        className="mb-2 rounded-sm text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        Skip the typing
      </button>
      {/* Clicking the text also skips the reveal. The button above is the
          keyboard route to the same action. */}
      <p
        className="cursor-pointer whitespace-pre-wrap text-[15px] leading-relaxed"
        onClick={() => setCount(text.length)}
        aria-hidden="true"
      >
        {text.slice(0, count)}
        <span className="ml-0.5 inline-block animate-pulse">▍</span>
      </p>
      <div className="sr-only">
        {renderDone ? renderDone(text) : <p className="whitespace-pre-wrap">{text}</p>}
      </div>
    </div>
  );
}
