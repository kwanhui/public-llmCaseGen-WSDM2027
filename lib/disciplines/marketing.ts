import { LEGAL_GROUNDING_RULE, type DisciplinePack } from "./types";

export const MARKETING: DisciplinePack = {
  id: "marketing",
  label: "Marketing",
  blurb:
    "Segmentation, positioning, channel choice and measurement, set against a competitor's move.",
  systemPrompt: `You are an experienced marketing instructor authoring a teaching case for an MBA / executive-education audience. Produce a case that:
- Centres on a realistic marketing decision facing a CMO, brand manager, growth lead, product marketer, or marketing analyst.
- Has a strategic core: positioning, segmentation, channel mix, pricing, or campaign measurement is implicit in the scenario.
- Names a fictional brand (avoid real brands) but situates it in a credible category, market, and consumer context.
- Provides enough market detail (category dynamics, competitor moves, customer-research signals, channel costs) for a learner to reason from, without giving away the answer.
- Embeds the instructor-supplied learning objective and must-cover concepts naturally.
- Names each must-cover concept, in the wording the instructor gave, at least once in the scenario, in a discussion question, or in a model answer, in a sentence that uses it; a synonym or a paraphrase does not count. The concepts must also be used, not only named.
- Calibrates difficulty: novice cases isolate one decision and provide most context; intermediate cases require trading off competing goals; advanced cases require integrating multiple frameworks under noisy signals.

Required structured output (Markdown allowed in fields):
- scenario: 350–600 words. Sets up the brand, the category, the customer, the competitive context, and the specific decision facing the protagonist.
- discussionQuestions: 4–6 open-ended questions, ordered from analysis to recommendation.
- modelAnswers: matched 1:1. Each is 60–120 words, shows reasoning and references frameworks where relevant.
- rubric: a teaching rubric with 4 weighted criteria (analysis quality, customer insight, strategic coherence, executional realism), each with a single-sentence "what excellent looks like".

${LEGAL_GROUNDING_RULE}

Personalisation: adapt the brand's category and customer to the target learner profile, but never weaken the learning objective. Stay in the discipline's vocabulary.`,
  styleNotes: [
    "Customers must feel real. Describe the job they are trying to get done, with demographics as secondary detail.",
    "Avoid empty buzzwords ('synergy', 'leverage'). Marketing language can be specific.",
    "Competitive context should constrain the choice. Without a competitor moving, most marketing decisions are too easy.",
    "Frame trade-offs explicitly: what would have to be true for option A to dominate option B?",
    "Rubric criteria should reward customer-grounded reasoning over framework name-dropping.",
  ],
  vocabulary: [
    "segmentation",
    "positioning",
    "STP",
    "JTBD",
    "CAC",
    "LTV",
    "category entry point",
    "share of voice",
    "media mix",
    "attribution",
    "incrementality",
    "brand equity",
    "price elasticity",
    "channel margin",
    "funnel conversion",
    "retention cohort",
  ],
  difficultyHints: {
    novice:
      "Single-decision case. Most market context is given. The learner applies one framework correctly. Limit competitive ambiguity.",
    intermediate:
      "Two or three considerations interact (e.g. segmentation × channel × budget). Competitor moves matter. One key signal is contested.",
    advanced:
      "Multi-framework integration under noisy market signals. Several consumer-research findings conflict. The 'right' answer requires choosing which signal to trust.",
  },
  fewShots: [
    {
      title: "Hello Mira: repositioning a sleep aid as a wellness brand",
      scenario:
        "Hello Mira launched in 2023 as a melatonin + L-theanine sleep gummy targeting working professionals in their 30s. Two years in, repeat-purchase rates are below category benchmark (24% vs. 41%) but the brand has surprisingly strong recognition among first-time mothers in the 28–35 segment. The new CMO believes the brand should reposition toward 'postpartum wellness', a smaller TAM but with much higher retention potential. The CEO worries this narrows the brand prematurely. You are the new brand director, asked to write the recommendation.",
      discussionQuestions: [
        "What does the segmentation evidence actually support, and what does it not?",
        "If you reposition, what does the brand stand for now, and what does it explicitly *not* stand for?",
        "What channel and creative implications follow, and which channels do you cut?",
        "How would you measure whether the reposition is working in the first 90 days?",
      ],
      rubric:
        "Customer insight (30%): names the JTBD shift, not just the demographic. Strategic coherence (30%): repositioning, channels, and creative all imply each other. Trade-off honesty (20%): names what's lost. Measurement design (20%): proposes leading indicators, not just lagging ones.",
    },
    {
      title: "Pasir Coffee: defending share against a value entrant",
      scenario:
        "Pasir Coffee has a 14% share of Singapore's specialty-coffee retail category. A new entrant, MetroBean, has opened 22 stores in 8 months at a 25% price discount, focused on transit-oriented locations. Pasir's repeat customer base is loyal (NPS 62) but the foot-traffic mix has skewed older. The CFO wants a tactical response in 8 weeks. The CMO is considering: (a) targeted price-match in transit corridors, (b) a loyalty-app push for cohort retention, or (c) a brand campaign reasserting craft credentials. You're the marketing lead asked to choose.",
      discussionQuestions: [
        "Frame the strategic problem: is this a price war, a brand-relevance test, or a customer-mix shift?",
        "Which option does the customer evidence most strongly support? What would have to be true for each alternative?",
        "What's the cost of being wrong on each option, and over what time horizon?",
        "How will you know within 4 weeks whether your chosen response is working?",
      ],
      rubric:
        "Diagnosis quality (25%): the strategic problem is named precisely. Option evaluation (25%): each option has a falsifiable condition. Cost-of-being-wrong (25%): treats reversibility honestly. Measurement (25%): proposes specific leading indicators.",
    },
  ],
  rubricTemplate: `Analysis quality (X%): what excellent looks like.
Customer insight (X%): what excellent looks like.
Strategic coherence (X%): what excellent looks like.
Executional realism (X%): what excellent looks like.`,
  variantEntryExample:
    "a telecommunications team meets a packaged-food brand's pricing decision as the partner running the joint promotion the price change would land in, with the brand, its figures and its marketing director unchanged",
  regenerateNoteExample:
    "keep the loyalty-tier figures and ask for the price elasticity to be worked out",
  redraftNoteExample:
    "the team is the channel partner, not the brand owner; keep every figure",
  feedbackChecks: [
    "Claims about named real brands or markets that the scenario does not give are flagged as unsupported.",
  ],
  defaultPhases: [
    {
      id: "mkt-situation",
      order: 0,
      label: "Situation & market scoping",
      studentTitle: "1. Situation & market scoping",
      studentPrompt:
        "Write a one-paragraph diagnosis: what is **actually happening** in the market for this brand? Distinguish symptoms (e.g. share decline) from underlying causes (e.g. customer-need shift, competitor entry, channel change). List your clarifying questions.",
      activities: ["clarifying_questions", "notes"],
      disciplineHint:
        "Write the symptom first, then the candidate cause, then what you would check to tell them apart.",
    },
    {
      id: "mkt-customer",
      order: 1,
      label: "Customer / segment discovery",
      studentTitle: "2. Customer / segment discovery",
      studentPrompt:
        "Who is the target customer, and what is their **job-to-be-done**? Define the relevant segment(s) using more than demographics. What customer evidence in the case supports your segment definition, and what evidence is missing?",
      activities: ["clarifying_questions", "notes"],
      disciplineHint:
        "Define the segment so that a different message would work better for it, and say what that message is.",
    },
    {
      id: "mkt-strategy",
      order: 2,
      label: "Strategy formulation",
      studentTitle: "3. Strategy formulation",
      studentPrompt:
        "Articulate a **positioning statement** in the form: *For [segment], [brand] is the [category frame] that [unique benefit] because [reason to believe]*. List 2–3 strategic options the brand could pursue, and the trade-off each one accepts.",
      activities: ["notes"],
      disciplineHint:
        "Read your positioning against a competitor. If it would fit them too, add the claim only this brand can make.",
    },
    {
      id: "mkt-tactical",
      order: 3,
      label: "Channel & tactical plan",
      studentTitle: "4. Channel & tactical plan",
      studentPrompt:
        "Translate your strategy into specifics: which **channels**, what **creative direction**, what **price/promotion** moves, and what **budget allocation** would you propose? What's explicitly *not* in scope and why?",
      activities: ["notes"],
      disciplineHint:
        "Name what you are cutting from scope, and say what would have to change for you to fund it.",
    },
    {
      id: "mkt-metrics",
      order: 4,
      label: "Metrics & KPIs",
      studentTitle: "5. Metrics & KPIs",
      studentPrompt:
        "How will you know your plan is working, and how will you know it isn't? Define **2–3 leading indicators** (early signals) and **1–2 lagging KPIs** (outcomes). What would cause you to abandon the plan, and at what threshold?",
      activities: ["notes", "answer_attempt"],
      disciplineHint:
        "Write the threshold that would make you stop the plan, and write it before launch.",
    },
  ],
};
