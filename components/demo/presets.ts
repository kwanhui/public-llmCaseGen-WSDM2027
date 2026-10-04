import type { CaseInput } from "@/lib/disciplines/types";

// Briefs and student messages for the public demo. They are copied here as
// typed data rather than read from the seed script or the walkthrough file at
// runtime, so the page carries no server import and no JSON of its own.

export interface DemoTeam {
  displayName: string;
  industry: string;
  role: string;
}

export interface DemoPreset {
  id: string;
  label: string;
  brief: CaseInput;
  // The first team takes a role outside the brief's organisation (a lender,
  // an analyst, a consultant, a referring agency), so that the rewrite of the
  // reader's vantage point shows on the page; the other two have roles inside
  // it.
  teams: [DemoTeam, DemoTeam, DemoTeam];
}

// Field limits of the brief form. The concept count is the demo route's own
// limit; the lengths follow the create-case route.
export const MAX_CONCEPTS = 4;
export const OBJECTIVE_MAX = 2000;
export const CONCEPT_MAX = 80;
export const PROFILE_FIELD_MAX = 120;
export const MESSAGE_MAX = 4000;

// The team the page and the guided run start with: the first, whose role
// cannot sit inside the organisation of the brief. Personalisation rewrites
// who the reader is and how they come to the case and keeps the organisation,
// so a team from outside it makes the rewrite visible.
export function defaultTeamIndex(p: DemoPreset): number {
  void p;
  return 0;
}

export const PRESETS: DemoPreset[] = [
  // The three seeded cases (scripts/seed-demo.ts, demo/sample-outputs), each
  // with a team from outside the case's organisation and then the first two
  // of its seeded teams.
  {
    id: "seed-finance",
    label: "Finance: valuing a regional bank with the DDM (example case)",
    brief: {
      discipline: "finance",
      learningObjective:
        "Apply DDM to value a regional bank under uncertainty in earnings growth and cost of equity.",
      difficulty: "intermediate",
      mustCoverConcepts: ["DDM", "cost of equity", "terminal value", "sensitivity analysis"],
      targetLearnerProfile: {
        industry: "retail banking, Singapore",
        role: "junior analyst",
        priorKnowledge: "intermediate",
      },
    },
    teams: [
      {
        displayName: "Team Gamma: equity research",
        industry: "Equity research, brokerage",
        role: "Sell-side analyst initiating coverage of the bank",
      },
      { displayName: "Team Alpha", industry: "retail banking", role: "junior analyst" },
      { displayName: "Team Beta", industry: "corporate treasury", role: "treasury associate" },
    ],
  },
  {
    id: "seed-marketing",
    label: "Marketing: repositioning a sleep-aid brand (example case)",
    brief: {
      discipline: "marketing",
      learningObjective:
        "Reposition a sleep-aid brand for a younger working-adult segment without alienating its core 50+ customers.",
      difficulty: "novice",
      mustCoverConcepts: [
        "segmentation",
        "positioning statement",
        "brand equity",
        "cannibalisation risk",
      ],
      targetLearnerProfile: {
        industry: "consumer health, Singapore",
        role: "brand assistant",
        priorKnowledge: "novice",
      },
    },
    teams: [
      {
        displayName: "Team Kestrel: advertising agency",
        industry: "Advertising agency, account planning",
        role: "Account planner at the brand's agency preparing the repositioning pitch",
      },
      { displayName: "Team Indigo", industry: "consumer health marketing", role: "brand assistant" },
      { displayName: "Team Jade", industry: "retail marketing", role: "marketing associate" },
    ],
  },
  {
    id: "seed-social-work",
    label: "Social work: an eldercare placement (example case)",
    brief: {
      discipline: "social_work",
      learningObjective:
        "Recommend an eldercare placement when adult siblings disagree on home care versus assisted living, and the older parent's stated preference shifts mid-assessment.",
      difficulty: "advanced",
      mustCoverConcepts: [
        "capacity assessment",
        "family-systems framing",
        "least-restrictive setting",
        "dual relationship risk",
      ],
      targetLearnerProfile: {
        industry: "community eldercare, Singapore",
        role: "MSW-track student on placement",
        priorKnowledge: "advanced",
      },
    },
    teams: [
      {
        displayName: "Team Lantern: referring centre",
        industry: "Senior activity centre run by a voluntary welfare organisation",
        role: "Centre social worker who knows the parent and referred the family",
      },
      {
        displayName: "Team Harbour",
        industry: "community eldercare social work",
        role: "MSW-track student on placement",
      },
      {
        displayName: "Team Meridian",
        industry: "hospital discharge planning",
        role: "medical social worker",
      },
    ],
  },
  // The six walkthrough briefs, two per discipline.
  {
    id: "walk-finance-expansion",
    label: "Finance: expansion",
    brief: {
      discipline: "finance",
      learningObjective:
        "Decide whether a family-owned food manufacturer should fund a second production line, by building the project's cash flows, discounting them at an appropriate rate, and testing how the decision changes with the key assumptions.",
      difficulty: "intermediate",
      mustCoverConcepts: [
        "net present value",
        "internal rate of return",
        "WACC",
        "sensitivity analysis",
      ],
      targetLearnerProfile: {
        industry: "Food manufacturing and distribution, Singapore",
        role: "Finance manager preparing a capital request for the owners",
        priorKnowledge:
          "Time value of money and basic financial statements; has not appraised a project before",
      },
    },
    teams: [
      {
        displayName: "Team C: bank lender",
        industry: "Commercial banking, term lending to manufacturers",
        role: "Credit analyst assessing the loan request for the second line",
      },
      {
        displayName: "Team A: family-owned F&B",
        industry: "Food manufacturing, family-owned",
        role: "Finance manager",
      },
      {
        displayName: "Team B: logistics SME",
        industry: "Third-party logistics, private company",
        role: "Operations director who owns the budget",
      },
    ],
  },
  {
    id: "walk-finance-liquidity",
    label: "Finance: liquidity",
    brief: {
      discipline: "finance",
      learningObjective:
        "Explain why a profitable neighbourhood retail chain keeps running short of cash, by reading its working-capital position and proposing changes to its collection, stock and supplier terms.",
      difficulty: "novice",
      mustCoverConcepts: ["working capital", "cash conversion cycle", "current ratio", "trade credit"],
      targetLearnerProfile: {
        industry: "Retail, small multi-outlet chain, Singapore",
        role: "Store operations lead moving into a finance role",
        priorKnowledge: "Reads a profit and loss statement; no formal finance training",
      },
    },
    teams: [
      {
        displayName: "Team C: bank relationship manager",
        industry: "Commercial banking, SME working-capital facilities",
        role: "Relationship manager reviewing the chain's request to raise its overdraft limit",
      },
      {
        displayName: "Team A: minimart chain",
        industry: "Convenience retail, five outlets",
        role: "Operations lead",
      },
      {
        displayName: "Team B: dental clinic group",
        industry: "Private healthcare clinics",
        role: "Practice manager",
      },
    ],
  },
  {
    id: "walk-marketing-positioning",
    label: "Marketing: positioning",
    brief: {
      discipline: "marketing",
      learningObjective:
        "Position a part-time data analytics certificate for mid-career professionals in a crowded continuing-education market, by choosing a target segment, stating the offer's value proposition, and mapping the enquiry-to-enrolment journey.",
      difficulty: "intermediate",
      mustCoverConcepts: [
        "market segmentation",
        "positioning",
        "value proposition",
        "customer journey",
      ],
      targetLearnerProfile: {
        industry: "Adult and continuing education provider, Singapore",
        role: "Programme marketing executive",
        priorKnowledge: "Runs social media campaigns; has not written a positioning statement",
      },
    },
    teams: [
      {
        displayName: "Team C: education consultancy",
        industry: "Management consultancy, education sector",
        role: "Consultant engaged by the provider to review the certificate's positioning",
      },
      {
        displayName: "Team A: university CET unit",
        industry: "University continuing-education unit",
        role: "Programme marketing executive",
      },
      {
        displayName: "Team B: private bootcamp",
        industry: "Private technology training company",
        role: "Growth marketing lead",
      },
    ],
  },
  {
    id: "walk-marketing-churn",
    label: "Marketing: churn",
    brief: {
      discipline: "marketing",
      learningObjective:
        "Recommend how a meal-kit subscription service should respond to rising cancellations after its first price increase, by estimating what a retained customer is worth and comparing retention offers against a change in pricing.",
      difficulty: "advanced",
      mustCoverConcepts: [
        "customer lifetime value",
        "churn rate",
        "retention strategy",
        "pricing strategy",
      ],
      targetLearnerProfile: {
        industry: "Direct-to-consumer food subscription, Singapore",
        role: "Head of customer marketing",
        priorKnowledge: "Manages CRM campaigns and reads dashboards; comfortable with spreadsheets",
      },
    },
    teams: [
      {
        displayName: "Team C: retention agency",
        industry: "Retention marketing agency",
        role: "Account lead pitching a retention programme to the meal-kit service",
      },
      {
        displayName: "Team A: meal-kit service",
        industry: "Meal-kit subscription",
        role: "Head of customer marketing",
      },
      {
        displayName: "Team B: fitness studio app",
        industry: "Boutique fitness studio with a class-pass app",
        role: "Membership manager",
      },
    ],
  },
  {
    id: "walk-social-work-discharge",
    label: "Social work: discharge",
    brief: {
      discipline: "social_work",
      learningObjective:
        "Plan the discharge of an older adult after a fall when the daughter who has been caring for him says she cannot continue, by assessing the caregiver's situation, keeping the older adult's own preferences central, and convening the family to agree on a care plan.",
      difficulty: "intermediate",
      mustCoverConcepts: [
        "caregiver burden",
        "person-centred care",
        "care planning",
        "family conference",
      ],
      targetLearnerProfile: {
        industry: "Acute hospital, medical social work department, Singapore",
        role: "Medical social worker in the first year of practice",
        priorKnowledge:
          "Completed placement in a community agency; new to hospital discharge work",
      },
    },
    teams: [
      {
        displayName: "Team C: family service centre",
        industry: "Family service centre, caregiver support",
        role: "Caregiver support worker to whom the hospital refers the daughter",
      },
      {
        displayName: "Team A: hospital social work",
        industry: "Acute hospital, medical social work",
        role: "Medical social worker",
      },
      {
        displayName: "Team B: community eldercare",
        industry: "Community eldercare centre",
        role: "Care coordinator",
      },
    ],
  },
  {
    id: "walk-social-work-school-refusal",
    label: "Social work: school refusal",
    brief: {
      discipline: "social_work",
      learningObjective:
        "Work with a fourteen-year-old who has stopped attending school since her parents separated, by mapping the systems around her, building on what she and her family already do well, engaging a parent who distrusts services, and coordinating the school, the family service centre and the parents on one plan.",
      difficulty: "advanced",
      mustCoverConcepts: [
        "ecological systems",
        "strengths-based practice",
        "engagement",
        "case coordination",
      ],
      targetLearnerProfile: {
        industry: "Family service centre, youth and family casework, Singapore",
        role: "Social worker with two years of experience taking on youth cases",
        priorKnowledge:
          "Adult casework and group work; limited experience with adolescents and schools",
      },
    },
    teams: [
      {
        displayName: "Team C: divorce support agency",
        industry: "Specialist agency supporting separating families",
        role: "Counsellor working with the parents through the separation",
      },
      {
        displayName: "Team A: family service centre",
        industry: "Family service centre",
        role: "Youth and family social worker",
      },
      {
        displayName: "Team B: school social work",
        industry: "Secondary school, student welfare",
        role: "School social worker",
      },
    ],
  },
];

// The brief the page opens with and the guided run uses, with the preset's
// default team.
export const SCRIPT_DEFAULT_PRESET_ID = "walk-finance-liquidity";

export const DISCIPLINE_LABELS: Record<CaseInput["discipline"], string> = {
  finance: "Finance",
  marketing: "Marketing",
  social_work: "Social work",
};

// The seeded finance case the student scene answers by default, and the task
// of its last phase, copied from the finance discipline pack
// (lib/disciplines/finance.ts, phase fin-recommend).
export const SEEDED_FINANCE_CASE_ID = "seed-case-finance";

export const FINANCE_LAST_PHASE = {
  id: "fin-recommend",
  studentTitle: "5. Recommendation memo",
  studentPrompt:
    "Write a one-paragraph recommendation in the protagonist's voice, suitable for an investment committee or executive memo. State the action, the headline number(s) supporting it, the key risk, and one explicit caveat or trigger that would change your view.",
};

// Two messages a student might send. The first asks for the answer outright;
// the second is a first attempt at the recommendation memo for the seeded
// finance case, written from its brief and questions, not from its model
// answers.
export const STUDENT_ASK_FOR_ANSWER = "Just give me the answer to question 2.";

export const STUDENT_DRAFT_ANSWER =
  "My recommendation is that Green River Bank should plan on dividend growth nearer 3% than 5%. The DDM value moves a lot when growth or the cost of equity changes, because most of the value sits in the terminal value. The key risk is a higher cost of equity if competition squeezes margins. I would change my view if two quarters of loan growth beat plan.";

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// A message that asks for an answer to a numbered question, or one too short
// to assess, gets a hint; a longer attempt gets feedback against the rubric.
export function studentMode(message: string): "hint" | "feedback" {
  const text = message.toLowerCase();
  const asksForAnswer = /\banswers?\b/.test(text) && /\b(?:question|q)\s*#?\s*\d+/.test(text);
  return asksForAnswer || wordCount(message) < 40 ? "hint" : "feedback";
}

// The discussion question a message names, as its 1-based number ("question
// 2", "Question 2", "Q2", "q. 2"), or null. The first one named wins.
export function namedQuestionNumber(message: string): number | null {
  const m = message.match(/\b(?:question|q)\s*\.?\s*#?\s*(\d{1,2})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}
