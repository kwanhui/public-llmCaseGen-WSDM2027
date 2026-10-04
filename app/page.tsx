import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { WorkflowDiagram } from "@/components/landing/workflow-diagram";
import { Comparison } from "@/components/landing/comparison";
import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth/config";

const STUDENT_VIEW_CAVEAT =
  "The student view is a shared example case. Other visitors do not see what you type, but the instructor who set this example can, and reloading the page clears it; use Download my work to keep a copy.";

const STUDENT_VIEW_NOTE = `Students need no account; they open the link their instructor gives them. ${STUDENT_VIEW_CAVEAT}`;

// Two columns side by side, for the comparison card.
function TwoColumnGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className="mr-1.5 inline-block h-4 w-4 shrink-0 align-[-2px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden="true"
    >
      {/* Two side-by-side rectangles, lightly filled with a line of "text"
          in each, so that they read as columns rather than as two
          missing-glyph boxes. */}
      <rect x="1" y="3" width="6" height="10" rx="1.25" fill="currentColor" fillOpacity="0.2" />
      <rect x="9" y="3" width="6" height="10" rx="1.25" fill="currentColor" fillOpacity="0.2" />
      <path d="M3 6.5h2M3 9h2M11 6.5h2M11 9h2" strokeLinecap="round" />
    </svg>
  );
}

export default async function LandingPage() {
  // Signed in, the header already carries Cases and Sign out, so the sign-in
  // button is left out rather than offering a sign-in to someone signed in.
  const session = await auth().catch(() => null);
  const signedIn = Boolean(session?.user);
  return (
    <>
    {/* The page has its own sign-in button below, so the header's "Sign in"
        is left out here. */}
    <SiteHeader hideSignIn />
    <main className="mx-auto flex max-w-6xl flex-col px-4 pb-10 pt-12 sm:px-6 sm:pt-16 lg:px-8">
      <header className="max-w-3xl">
        <h1 className="text-4xl font-bold sm:text-5xl">
          Pers<span className="text-primary">Case</span>
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground sm:text-xl sm:leading-relaxed">
          An authoring tool for instructors who teach with case studies: a draft from your
          brief and discipline notes, which you edit and approve before any student sees it.
        </p>
      </header>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Link
          href="/demo"
          className="group block rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-md shadow-primary/20 transition-[background-color,box-shadow,transform] duration-150 hover:bg-primary-hover hover:shadow-lg active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:max-w-sm"
        >
          <span className="block text-base font-semibold">
            <TwoColumnGlyph />
            Try the live demo
          </span>
          <span className="mt-1 block text-sm text-primary-foreground/90">
            Beside a standard LLM. No sign-in.
          </span>
        </Link>
        {signedIn ? null : (
          <Link href="/admin/login" className={buttonClass("outline", "lg")}>
            Instructor sign-in
          </Link>
        )}
        <Link
          href="/case/seedmktconsumer1"
          title={STUDENT_VIEW_NOTE}
          aria-describedby="student-view-note"
          className={buttonClass("outline", "lg")}
        >
          See a student&apos;s view
        </Link>
      </div>
      {/* Visible, not only a tooltip: a phone has no hover. */}
      <p id="student-view-note" className="mt-4 max-w-2xl text-sm text-muted-foreground">
        {STUDENT_VIEW_CAVEAT}
      </p>

      <section className="mt-20 sm:mt-24">
        <WorkflowDiagram />
      </section>

      <details className="group/compare mt-20 sm:mt-24">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-3 rounded-md [&::-webkit-details-marker]:hidden">
          <h2 className="inline text-2xl font-semibold sm:text-3xl">Compared with a traditional case study</h2>
          <svg
            viewBox="0 0 16 16"
            className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-150 group-open/compare:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </summary>
        <div className="mt-6">
          <Comparison />
        </div>
      </details>

      <footer className="mt-24 border-t pt-6 text-xs text-muted-foreground">
        Corpus: 97 notes written by the authors (33 finance, 32 marketing, 32 social work).
      </footer>
    </main>
    </>
  );
}
