"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format-date";
import { CARD } from "@/components/admin/styles";

// A shared internal note for co-teaching instructors. Not shown to students.
interface Props {
  caseId: string;
  initialNote: string;
  author: string | null;
  updatedAt: string | null;
  // Seeded example case: the API refuses to write a note against it, so the
  // control is taken away rather than left to fail.
  readOnly?: boolean;
}

export function CoInstructorNote({
  caseId,
  initialNote,
  author,
  updatedAt,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`${CARD} px-4 py-3 text-sm sm:px-5`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">
          Note for co-instructors (not shown to students)
        </h3>
        {!editing && !readOnly ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {initialNote ? "Edit" : "Add note"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            className="min-h-[80px] resize-y"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. what was changed in the draft, and what to check before the next run"
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={saving}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setNote(initialNote); }} disabled={saving}>
              Cancel
            </Button>
            {error ? <span className="text-sm text-flag">{error}</span> : null}
          </div>
        </div>
      ) : initialNote ? (
        <div className="mt-2">
          <p className="whitespace-pre-wrap text-sm">{initialNote}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {author ?? "Instructor"}
            {updatedAt ? `, ${formatDateTime(updatedAt)}` : null}
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No note yet.</p>
      )}
    </div>
  );
}
