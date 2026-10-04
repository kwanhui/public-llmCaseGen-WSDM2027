import { SiteHeader } from "@/components/site-header";

// Shown when a team link does not resolve: the case was removed, or the link
// lost a character in a chat message. One wording covers both without blaming
// the student, rather than showing the framework's bare 404.
export default function CaseNotFound() {
  return (
    <>
    <SiteHeader variant="student" />
    <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-xl flex-col justify-center px-4 py-12 sm:px-6">
      <div className="rounded-lg border bg-card px-5 py-6 shadow-xs sm:px-7">
      <h1 className="text-2xl font-semibold">This link is no longer active.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Check with your instructor.
      </p>
      </div>
    </main>
    </>
  );
}
