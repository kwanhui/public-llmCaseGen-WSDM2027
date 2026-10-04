import type { Metadata } from "next";
import { connection } from "next/server";
import { DemoClient } from "@/components/demo/demo-client";
import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth/config";
import { isDemoPaused } from "@/lib/demo/guards";

export const metadata: Metadata = {
  title: "Live demo · PersCase",
};

// ?run=1 plays the guided run once the page has rendered; ?run=step starts it
// in step mode, where each step waits for Next.
function autorunFrom(value: string | string[] | undefined): "play" | "step" | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "1" || v === "play") return "play";
  if (v === "step") return "step";
  return null;
}

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read the kill switch per request rather than at build time, so the page
  // says the demo is paused before anyone presses a button.
  await connection();
  const paused = isDemoPaused();
  const autorun = autorunFrom((await searchParams).run);
  // Signed in, the contrastive-view link goes straight to the example case's
  // compare page rather than to the sign-in page.
  const session = await auth().catch(() => null);
  const signedIn = Boolean(session?.user);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        <DemoClient initiallyPaused={paused} autorun={autorun} signedIn={signedIn} />
      </main>
    </>
  );
}
