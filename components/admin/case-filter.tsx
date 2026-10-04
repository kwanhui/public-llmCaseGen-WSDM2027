"use client";

import { useRouter } from "next/navigation";
import { LABEL } from "@/components/admin/styles";

// The case filter above the analytics charts. It sets `?caseId=` on the page,
// and "All cases" removes it.
export function CaseFilter({
  cases,
  value,
}: {
  cases: { id: string; label: string }[];
  value: string | null;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="analytics-case" className={LABEL}>
        Case
      </label>
      <select
        id="analytics-case"
        value={value ?? ""}
        onChange={(e) => {
          const id = e.target.value;
          router.push(id ? `/admin/analytics?caseId=${encodeURIComponent(id)}` : "/admin/analytics");
        }}
        className="h-9 w-full max-w-md truncate rounded-md border border-input/70 bg-card px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
      >
        <option value="">All cases</option>
        {cases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}
