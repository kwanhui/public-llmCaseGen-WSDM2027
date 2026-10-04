"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { CARD, LINK } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

interface TeamLink {
  id: string;
  name: string;
  url: string;
}

// The team links on the case page, under the team variants summary, so that the
// instructor can copy one without going to the Team variants page.
export function TeamLinks({
  caseId,
  links,
  primary,
}: {
  caseId: string;
  links: TeamLink[];
  // Generating team variants is the next action (approved, no links yet).
  primary: boolean;
}) {
  return (
    <section className={cn(CARD, "px-4 py-4 sm:px-5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            Team variants{" "}
            <span className="font-normal tabular-nums text-muted-foreground">({links.length})</span>
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {links.length === 0
              ? "No team variants yet. Each team variant gets its own link."
              : "One link per team. "}
            {links.length > 0 ? (
              <Link href={`/admin/analytics?caseId=${encodeURIComponent(caseId)}`} className={LINK}>
                Activity for this case
              </Link>
            ) : null}
          </p>
        </div>
        <Link
          href={`/admin/cases/${caseId}/variants`}
          className={buttonClass(primary ? "primary" : "outline", "sm")}
          aria-label={links.length === 0 ? undefined : "Open team variants"}
        >
          {links.length === 0 ? "Generate team variants" : "Open"}
        </Link>
      </div>
      {links.length > 0 ? (
        <ul className="mt-3 divide-y border-t">
          {links.map((l) => (
            <TeamLinkRow key={l.id} link={l} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function TeamLinkRow({ link }: { link: TeamLink }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  return (
    <li className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-sm font-medium sm:w-48 sm:truncate">{link.name}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <code className="flex h-8 min-w-0 flex-1 items-center truncate rounded-md border bg-muted/50 px-2.5 font-mono text-xs">
          {link.url}
        </code>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </li>
  );
}
