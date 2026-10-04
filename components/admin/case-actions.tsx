"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { EXAMPLE_CASE_TITLE } from "@/components/admin/status-pill";
import { InlineConfirm } from "@/components/admin/inline-confirm";
import { CARD } from "@/components/admin/styles";
import { cn } from "@/lib/utils";

// What Delete takes with it, in the words of the confirmation.
function deleteMessage(teamLinks: number, savedAnswers: number): string {
  const links =
    teamLinks === 0
      ? "It has no team links."
      : `${teamLinks === 1 ? "Its team link stops" : `Its ${teamLinks} team links stop`} working${
          savedAnswers > 0
            ? `, and ${savedAnswers} saved student ${savedAnswers === 1 ? "answer is" : "answers are"} removed`
            : ""
        }.`;
  return `${links} This cannot be undone.`;
}

function DeleteConfirm({
  teamLinks,
  savedAnswers,
  busy,
  onCancel,
  onConfirm,
  className,
}: {
  teamLinks: number;
  savedAnswers: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  className?: string;
}) {
  return (
    <InlineConfirm
      title="Delete this case?"
      action="Delete"
      danger
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
      className={className}
    >
      <p>{deleteMessage(teamLinks, savedAnswers)}</p>
    </InlineConfirm>
  );
}

async function deleteCase(id: string): Promise<void> {
  const res = await fetch(`/api/admin/cases/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.message ?? j.error ?? `HTTP ${res.status}`);
  }
}

async function duplicateCase(id: string): Promise<string> {
  const res = await fetch(`/api/admin/cases/${id}/duplicate`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data.id as string;
}

interface Props {
  id: string;
  seeded: boolean;
  teamLinks: number;
  savedAnswers: number;
}

const ITEM =
  "flex w-full items-center whitespace-nowrap rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent";

// One Actions menu per case row: Open, Duplicate, Delete.
export function CaseActions({ id, seeded, teamLinks, savedAnswers }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"duplicate" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function duplicate() {
    setBusy("duplicate");
    setError(null);
    try {
      const newId = await duplicateCase(id);
      router.push(`/admin/cases/${newId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed.");
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await deleteCase(id);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setBusy(null);
    }
  }

  return (
    <div ref={root} className="relative inline-block text-left">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={busy !== null}
        className={buttonClass("outline", "sm")}
      >
        {busy === "duplicate" ? "Duplicating…" : busy === "delete" ? "Deleting…" : "Actions"}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(CARD, "absolute right-0 z-30 mt-1 w-56 p-1 shadow-md")}
        >
          <Link role="menuitem" href={`/admin/cases/${id}`} className={ITEM}>
            Open
          </Link>
          <button role="menuitem" type="button" onClick={duplicate} className={ITEM}>
            Duplicate
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
              setConfirming(true);
            }}
            disabled={seeded}
            title={seeded ? EXAMPLE_CASE_TITLE : undefined}
            className={cn(ITEM, !seeded && "text-flag")}
          >
            {seeded ? "Delete (not for example cases)" : "Delete"}
          </button>
        </div>
      ) : null}
      {confirming ? (
        <DeleteConfirm
          teamLinks={teamLinks}
          savedAnswers={savedAnswers}
          busy={busy === "delete"}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
          className="w-72 max-w-[calc(100vw-2rem)] text-left"
        />
      ) : null}
      {error ? <span className="mt-1 block text-sm text-flag">{error}</span> : null}
    </div>
  );
}

// Delete on the case page, with the same confirmation as the list.
export function DeleteCaseButton({
  id,
  teamLinks,
  savedAnswers,
}: {
  id: string;
  teamLinks: number;
  savedAnswers: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteCase(id);
      router.push("/admin/cases");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start">
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          disabled={busy || confirming}
          aria-expanded={confirming}
          className="rounded-sm text-sm font-medium text-flag underline-offset-2 hover:underline disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete case"}
        </button>
        {error ? <span className="text-sm text-flag">{error}</span> : null}
      </span>
      {confirming ? (
        <DeleteConfirm
          teamLinks={teamLinks}
          savedAnswers={savedAnswers}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
          className="max-w-md"
        />
      ) : null}
    </div>
  );
}
