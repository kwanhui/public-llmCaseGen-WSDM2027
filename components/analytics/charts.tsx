"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";
import type { DisciplineCount, SectionRegenCount, DailyViewPoint, ResponsesByDiscipline } from "@/lib/analytics/queries";

const DISCIPLINE_LABELS: Record<string, string> = {
  finance: "Finance",
  marketing: "Marketing",
  social_work: "Social work",
};

const SECTION_LABELS: Record<string, string> = {
  scenario: "Scenario",
  discussionQuestions: "Questions",
  modelAnswers: "Answers",
  rubric: "Rubric",
};

// The primary accent for a single series; the student accent marks the second
// series where a chart has two. No other colour is used.
const SERIES = "hsl(var(--primary))";
const SECOND_SERIES = "hsl(var(--student))";

const AXIS = {
  stroke: "hsl(var(--muted-foreground))",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

const TOOLTIP = {
  contentStyle: {
    fontSize: 13,
    background: "hsl(var(--card))",
    color: "hsl(var(--card-foreground))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    boxShadow: "0 1px 2px 0 hsl(205 40% 11% / 0.05)",
  },
  cursor: { fill: "hsl(var(--muted))" },
} as const;

const LEGEND = { wrapperStyle: { fontSize: 13, paddingTop: 8 } } as const;

function ChartFrame({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 rounded-lg border bg-card px-4 py-4 text-card-foreground shadow-xs sm:px-5">
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      <div className="h-64">{children}</div>
      <figcaption className="mt-3 text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

// `oneCase`: the analytics page is filtered to one case, so the captions say
// "this case" rather than describing the whole lab.
export function AuthoringTimeChart({
  data,
  oneCase = false,
}: {
  data: DisciplineCount[];
  oneCase?: boolean;
}) {
  const formatted = data.map((d) => ({
    name: DISCIPLINE_LABELS[d.discipline] ?? d.discipline,
    minutes: Math.round((d.meanAuthoringMinutes ?? 0) * 10) / 10,
    count: d.count,
  }));
  return (
    <ChartFrame
      title="Mean authoring time by discipline"
      caption={
        oneCase
          ? "Minutes from saving the brief to approval for this case, once it is approved."
          : "Minutes from saving the brief to approval, averaged over the approved cases of each discipline."
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis {...AXIS} width={36} />
          <Tooltip {...TOOLTIP} />
          <Bar dataKey="minutes" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function RegenCountChart({
  data,
  oneCase = false,
}: {
  data: SectionRegenCount[];
  oneCase?: boolean;
}) {
  const formatted = data.map((d) => ({
    name: SECTION_LABELS[d.section] ?? d.section,
    count: d.count,
  }));
  return (
    <ChartFrame
      title="Section regenerations"
      caption={
        oneCase
          ? "How many times each section of this case was regenerated."
          : "How many times each section was regenerated, over all cases."
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} width={36} />
          <Tooltip {...TOOLTIP} />
          <Bar dataKey="count" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function StudentActivityChart({
  data,
  oneCase = false,
}: {
  data: DailyViewPoint[];
  oneCase?: boolean;
}) {
  const formatted = data.map((d) => ({
    day: d.day.slice(5),
    views: d.views,
    responses: d.responsesSaved,
  }));
  return (
    <ChartFrame
      title={`Student activity (${formatted.length} days)`}
      caption={
        oneCase
          ? "Student page views and saved answers per day on this case, by UTC date."
          : "Student page views and saved answers per day, by UTC date."
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formatted}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="day" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} width={36} />
          <Tooltip {...TOOLTIP} />
          <Legend {...LEGEND} />
          <Line
            type="linear"
            isAnimationActive={false}
            dataKey="views"
            stroke={SERIES}
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Views"
          />
          <Line
            type="linear"
            isAnimationActive={false}
            dataKey="responses"
            stroke={SECOND_SERIES}
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Answers saved"
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function EngagementChart({
  data,
  oneCase = false,
}: {
  data: ResponsesByDiscipline[];
  oneCase?: boolean;
}) {
  const formatted = data.map((d) => ({
    name: DISCIPLINE_LABELS[d.discipline] ?? d.discipline,
    Views: d.views,
    "Answers saved": d.responses,
  }));
  return (
    <ChartFrame
      title="Engagement by discipline"
      caption={
        oneCase
          ? "Student page views and saved answers on this case."
          : "Student page views and saved answers, summed over the cases of each discipline."
      }
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted}>
          <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} width={36} />
          <Tooltip {...TOOLTIP} />
          <Legend {...LEGEND} />
          <Bar dataKey="Views" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
          <Bar dataKey="Answers saved" fill={SECOND_SERIES} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
