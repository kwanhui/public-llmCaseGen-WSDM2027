import Link from "next/link";
import { auth, signOut } from "@/lib/auth/config";
import { cn } from "@/lib/utils";

// One header for every page: the wordmark goes to the landing page, and the
// links on the right depend on who is looking.
//
// - default, signed out: Live demo, Sign in
// - default, signed in: Live demo, Cases, Sign out
// - student: Home, plus "Example case" on a seeded example link
//
// The landing page passes hideSignIn: it has its own "Instructor sign-in"
// button, so the header leaves its "Sign in" out there rather than offering
// the same link under two names.
//
// The student variant reads no session: a student has no account, and the
// team page should not change with the instructor's cookies.
interface Props {
  variant?: "default" | "student";
  // Student variant only: the page is a seeded example rather than a real team
  // link.
  exampleCase?: boolean;
  // Default variant only: leave out "Sign in" (the landing page carries its
  // own "Instructor sign-in" button).
  hideSignIn?: boolean;
}

const LINK =
  "inline-flex h-9 items-center whitespace-nowrap rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-3";

export async function SiteHeader({
  variant = "default",
  exampleCase = false,
  hideSignIn = false,
}: Props) {
  const student = variant === "student";
  const session = student ? null : await auth().catch(() => null);
  const signedIn = Boolean(session?.user);

  return (
    <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="rounded-md px-1 text-lg font-bold leading-none tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Pers<span className="text-primary">Case</span>
          </Link>
          {student && exampleCase ? (
            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-input/80 px-2 py-0.5 text-[13px] font-medium leading-4 text-muted-foreground">
              Example case
            </span>
          ) : null}
        </div>
        <nav aria-label="Site" className="flex items-center gap-0.5">
          {student ? (
            <Link href="/" className={LINK}>
              Home
            </Link>
          ) : (
            <>
              <Link href="/demo" className={LINK}>
                Live demo
              </Link>
              {signedIn ? (
                <>
                  <Link href="/admin/cases" className={LINK}>
                    Cases
                  </Link>
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: "/" });
                    }}
                  >
                    <button type="submit" className={cn(LINK, "cursor-pointer")}>
                      Sign out
                    </button>
                  </form>
                </>
              ) : hideSignIn ? null : (
                <Link href="/admin/login" className={LINK}>
                  Sign in
                </Link>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
