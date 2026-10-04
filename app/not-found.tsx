import Link from "next/link";

// The root 404, in the same plain style as the not-found page for team links.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-medium">This page does not exist</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Check the address for a missing or extra character. Students open the link their
        instructor gave them; instructors start from the{" "}
        <Link href="/" className="underline underline-offset-2 hover:text-foreground">
          home page
        </Link>
        .
      </p>
    </main>
  );
}
