import { LEGAL_GROUNDING_RULE, type DisciplinePack } from "./types";

export const FINANCE: DisciplinePack = {
  id: "finance",
  label: "Finance",
  quantitative: true,
  blurb:
    "Valuation, capital structure and financial analysis. Each case has a quantitative core and ends in a recommendation.",
  systemPrompt: `You are an experienced finance instructor authoring a teaching case for an MBA / executive-education audience. Produce a case that:
- Centres on a realistic decision facing a CFO, treasurer, controller, equity analyst, or finance manager.
- Has a quantitative core: at least one calculation, ratio, valuation, or sensitivity is implicit in the scenario.
- Names a fictional company (avoid real public companies) but situates it in a credible sector and country/region.
- Provides enough numerical detail (growth rates, margins, capital structure, comparable benchmarks) for a learner to reason from, without giving away the answer.
- Embeds the instructor-supplied learning objective and must-cover concepts naturally, so that they are unavoidable on the path to the recommendation.
- Names each must-cover concept, in the wording the instructor gave, at least once in the scenario, in a discussion question, or in a model answer, in a sentence that uses it; a synonym or a paraphrase does not count. The concepts must also be used, not only named.
- Calibrates difficulty: novice cases isolate one concept and provide most assumptions; intermediate cases require interpreting trade-offs; advanced cases require integrating multiple concepts under ambiguity.

Required structured output (Markdown allowed in fields):
- scenario: 350–600 words. Sets up the company, the decision, the stakeholder voice, the data the learner has, and the specific question facing them.
- discussionQuestions: 4–6 open-ended questions, ordered from framing to evaluation.
- modelAnswers: matched 1:1 to discussionQuestions. Each answer is 60–120 words and shows the reasoning as well as the conclusion.
- rubric: a teaching rubric with 4 weighted criteria (numerical accuracy, depth of reasoning, treatment of assumptions, quality of recommendation), each with a single-sentence "what excellent looks like".

${LEGAL_GROUNDING_RULE}

Personalisation: adapt the company's industry, the protagonist's role, and the stakes to the target learner profile, but never weaken the learning objective. Keep terminology consistent with the discipline vocabulary supplied.`,
  styleNotes: [
    "Use the second-person framing only sparingly; protagonists are named.",
    "Numbers must be internally consistent. If you give revenue and margin, make sure operating profit follows from them.",
    "Avoid absolute claims about real companies or jurisdictions; the case is fictional.",
    "Discussion questions should ask the learner to reason. Avoid recall prompts such as 'Define WACC'.",
    "Rubric criteria should be observable, for example 'identifies the missing assumption'.",
  ],
  vocabulary: [
    "WACC",
    "DCF",
    "free cash flow",
    "capital structure",
    "cost of equity",
    "EBITDA",
    "working capital",
    "covenant",
    "comparable",
    "terminal value",
    "sensitivity",
    "scenario analysis",
    "leverage",
    "credit spread",
    "duration",
    "convexity",
  ],
  difficultyHints: {
    novice:
      "Single-concept case. Provide most numerical inputs explicitly. The learner's job is to apply one tool correctly. Limit ambiguity.",
    intermediate:
      "Two or three concepts interact. The learner must choose between competing methods or surface a missing assumption. One key input is deliberately vague.",
    advanced:
      "Multi-concept integration under genuine uncertainty. Several inputs are missing or contested. The 'right' answer depends on a judgment call the learner must defend.",
  },
  fewShots: [
    {
      title: "Marin Coastal Logistics: should we lever up the LBO?",
      scenario:
        "You are the lead associate on a buyout of Marin Coastal Logistics, a Pacific-Northwest regional trucker with $180M revenue and 11% EBITDA margins. The PE sponsor wants to push pro-forma debt to 6× EBITDA to fund a roll-up of two smaller competitors. The credit committee flagged that interest-coverage covenants would tighten if a recession trims volumes by 8%. The lender's term sheet allows 5.5× at SOFR+475 or 6.0× at SOFR+575 with a maintenance covenant of 2.0× interest coverage. Build the case to the IC.",
      discussionQuestions: [
        "What does pro-forma interest coverage look like at 6.0× under the lender's pricing? Show the calculation.",
        "Under an 8% volume decline, which leverage option breaches covenant first, and by how much?",
        "Which assumption (margin compression vs. volume decline vs. roll-up synergy) does your recommendation hinge on?",
        "What single piece of due-diligence work would you prioritise to retire the most uncertainty?",
      ],
      rubric:
        "Numerical accuracy (30%): coverage and breach calculations are arithmetically correct. Reasoning depth (30%): connects covenant maths to the buyout thesis. Treatment of assumptions (20%): explicitly identifies which input dominates. Recommendation quality (20%): proposes a specific action with a kill-switch.",
    },
    {
      title: "Sundara Foods: a 5-year pro-forma for the Series B raise",
      scenario:
        "Sundara Foods, a Singapore-based plant-based snack startup, is preparing a Series B pitch. Revenue grew from $2M to $14M over three years. Gross margin sits at 38% but variable trade spend is rising. Founders want to price the round at $90M post on $14M ARR. Your job, as the CFO, is to build the 5-year pro-forma that supports the ask. The lead investor wants to see the scenario where the company defaults on its own milestones.",
      discussionQuestions: [
        "What revenue CAGR and gross-margin trajectory does $90M post imply against typical Series B comps?",
        "Sketch the downside case where ARR growth halves. At what point does the company need a bridge?",
        "How would you calibrate the burn-rate assumption, and what would change your view?",
        "Which line item in your pro-forma is doing the most work, and how do you defend it to the lead investor?",
      ],
      rubric:
        "Comp logic (25%): grounds the multiple in named comparables. Pro-forma internal consistency (25%): COGS, opex, and burn track the revenue path. Downside calibration (25%): identifies a specific trigger and runway implication. Defence quality (25%): names the load-bearing assumption explicitly.",
    },
  ],
  rubricTemplate: `Numerical accuracy (X%): what excellent looks like.
Depth of reasoning (X%): what excellent looks like.
Treatment of assumptions (X%): what excellent looks like.
Recommendation quality (X%): what excellent looks like.`,
  variantEntryExample:
    "a retail-banking team meets a manufacturer's financing decision as the lender the manufacturer has asked for terms, with the manufacturer, its figures and its finance director unchanged",
  regenerateNoteExample:
    "keep the Singapore setting and add a sensitivity table at 6% and 10%",
  redraftNoteExample:
    "the bank is the lender, not the buyer; keep every figure",
  feedbackChecks: [
    "Figures stated in the answer that cannot be derived from the inputs the scenario gives are flagged as unsupported; the tool does not recompute them.",
  ],
  defaultPhases: [
    {
      id: "fin-frame",
      order: 0,
      label: "Frame the question",
      studentTitle: "1. Frame the question",
      studentPrompt:
        "Read the scenario carefully. In your own words, write down the **central financial decision** the protagonist faces, who the stakeholders are, and what success would look like. Then list any clarifying questions you'd want to ask before doing any maths.",
      activities: ["clarifying_questions", "notes"],
      disciplineHint:
        "Name the decision and the time horizon before you calculate anything.",
      suggestedMinutes: 10,
    },
    {
      id: "fin-data",
      order: 1,
      label: "Gather & inspect financials",
      studentTitle: "2. Gather & inspect the financials",
      studentPrompt:
        "What numerical inputs do you have? What's missing or ambiguous? List the **financial statements, ratios, or external benchmarks** you'd need to evaluate this. Note any inconsistencies in the data the case provides.",
      activities: ["clarifying_questions", "notes"],
      disciplineHint:
        "If data are missing, say what you would ask for and why.",
      suggestedMinutes: 10,
    },
    {
      id: "fin-model",
      order: 2,
      label: "Quantitative modelling",
      studentTitle: "3. Quantitative modelling",
      studentPrompt:
        "Work the numbers. Use the data in the case to compute the key quantities (e.g. valuation, ratio, projection). Show your steps and state every assumption you make. If you have to choose a method (e.g. DCF vs. comps), say why.",
      activities: ["notes"],
      disciplineHint:
        "Write your assumptions in a labelled list before calculating. You'll need to defend each one in phase 4.",
      suggestedMinutes: 20,
    },
    {
      id: "fin-sensitivity",
      order: 3,
      label: "Sensitivity & risks",
      studentTitle: "4. Sensitivity & risks",
      studentPrompt:
        "Stress-test your answer. Which **one assumption**, if it shifted by a plausible amount, would flip your recommendation? What downside scenario worries you most, and what would you watch for to detect it early?",
      activities: ["notes"],
      disciplineHint:
        "Try a plausible shift in each input. If nothing moves your answer, widen the question.",
      suggestedMinutes: 15,
    },
    {
      id: "fin-recommend",
      order: 4,
      label: "Recommendation memo",
      studentTitle: "5. Recommendation memo",
      studentPrompt:
        "Write a one-paragraph recommendation in the protagonist's voice, suitable for an investment committee or executive memo. State the action, the headline number(s) supporting it, the key risk, and one explicit caveat or trigger that would change your view.",
      activities: ["notes", "answer_attempt"],
      disciplineHint:
        "State your recommendation, then the one condition under which you would reverse it.",
      suggestedMinutes: 15,
    },
  ],
};
