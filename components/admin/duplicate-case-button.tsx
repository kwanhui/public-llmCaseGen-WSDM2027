"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

// On an example case the copy is the next action, so the case page makes this
// the primary button there.
export function DuplicateCaseButton({
  caseId,
  primary = false,
}: {
  caseId: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/cases/${caseId}/duplicate`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.id) {
        router.push(`/admin/cases/${data.id}`);
        return;
      }
    } catch {
      // fall through
    }
    setBusy(false);
  }

  return (
    <Button variant={primary ? "primary" : "outline"} size="sm" onClick={duplicate} disabled={busy}>
      {busy ? "Duplicating…" : "Duplicate"}
    </Button>
  );
}
