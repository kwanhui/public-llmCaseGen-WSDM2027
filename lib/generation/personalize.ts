import { generateObject } from "ai";
import { getGenerationModel } from "@/lib/llm/client";
import { getDisciplinePack } from "@/lib/disciplines";
import type { CaseInput } from "@/lib/disciplines/types";
import { GenerationOutputSchema, type CaseContent } from "./schema";
import { normalizeOutput, MODEL_ANSWER_RULE } from "./generate-case";

export interface LearnerProfileOverride {
  // The team's label. Kept out of the prompt: given to the model it was read as
  // content, and teams came back with the label as the company's brand name
  // ("Team Gym is a boutique fitness studio chain").
  displayName?: string;
  industry?: string;
  role?: string;
}

export interface PersonalizeInput {
  base: CaseContent;
  caseInput: CaseInput;
  override: LearnerProfileOverride;
  // The instructor's note when redrafting one team's variant.
  editorNote?: string;
  // Output cap for the model call; set by the public demo route only.
  maxTokens?: number;
}

export async function personaliseCaseContent({
  base,
  caseInput,
  override,
  editorNote,
  maxTokens,
}: PersonalizeInput): Promise<CaseContent> {
  const pack = getDisciplinePack(caseInput.discipline);
  const profile = caseInput.targetLearnerProfile;
  const newProfile = {
    industry: override.industry ?? profile.industry,
    role: override.role ?? profile.role,
    // Prior knowledge is the master case's throughout. It is not collected
    // per team, because per-team values produced identical text.
    priorKnowledge: profile.priorKnowledge,
  };
  const note = editorNote?.trim();
  // A team whose practice context is the master's own needs no setting change at
  // all. Left to the model, it invented an employer and renamed the master's
  // organisation, so the case is decided here and stated in the prompt.
  // A team is in the master's own context when the two read as the same field,
  // which includes a team label that adds the discipline to it ("consumer
  // health" and "consumer health marketing").
  const normaliseContext = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const masterContext = normaliseContext(profile.industry);
  const teamContext = normaliseContext(newProfile.industry);
  const sameContext =
    masterContext.length >= 4 &&
    teamContext.length >= 4 &&
    (masterContext === teamContext ||
      masterContext.includes(teamContext) ||
      teamContext.includes(masterContext));

  const userPrompt = [
    `# Personalisation task`,
    ``,
    `You are producing a team variant of an approved case for a small student team`,
    `to work through together. This is a rewrite of the surface of one case, not a`,
    `new case. Change only what the rules below allow you to change, and copy the`,
    `rest across unchanged.`,
    ``,
    `**Learning objective (unchanged):** ${caseInput.learningObjective}`,
    `**Difficulty (unchanged):** ${caseInput.difficulty}`,
    `**Must-cover concepts (unchanged):** ${caseInput.mustCoverConcepts.join(", ") || "(none)"}`,
    ``,
    `**This team's profile**`,
    `- Industry / practice context: ${newProfile.industry}`,
    `- Role: ${newProfile.role}`,
    `- Prior knowledge: ${newProfile.priorKnowledge}`,
    ``,
    `## First decide who the protagonist is and how they come to the case`,
    `The organisation that faces the decision in the original stays in the variant. Before writing anything, note the name the original gives it and copy that name letter for letter everywhere it appears. If your variant spells that name differently anywhere, the variant is wrong.`,
    `The protagonist is the person the original addresses as "you". Everyone the original names by name keeps their own employer and their own job: the organisation's CFO, manager or director stays with that organisation and is never moved into the team's employer, and is never made the protagonist. Keep the second person "you" wherever the original uses it.`,
    `Invent no person. Every personal name in your variant is a name that appears in the original, and you add none. Where a sentence needs someone to ask, instruct or hand over the work, use a person the original already names, or name the role and no person, as in "the chief financial officer" or "the brand's marketing director". A named officer the original does not have is a mistake, however natural it reads.`,
    `Now read the team's practice context and role against the original protagonist's, decide which of the cases below applies, and say nothing about that decision in the output.`,
    ...(sameContext
      ? [
          `This team's practice context is the original's own, so case A0 applies. Do not weigh case A or case B.`,
        ]
      : []),
    `Case A0. The team's practice context is the original's own. Then the setting does not change at all. The protagonist keeps the original's seat inside the organisation that faces the decision, that organisation's name is copied exactly, and no second organisation, agency, firm or consultancy of any kind appears. Change the protagonist's job title to the team's role, and at most one sentence saying where the protagonist stands. Everything else is copied across word for word.`,
    `In case A0, if the original's protagonist is a named person whose job is not the team's role, leave that person exactly as the original has them, doing exactly what they do, and put the learner in the team's role inside the same organisation in one sentence, as in "You are a brand assistant at SleepWell, working to the chief marketing officer". The learner is never engaged, hired or brought in from outside in case A0.`,
    `Case A. Someone with the team's role, working in the team's kind of organisation, could plausibly hold the original protagonist's seat inside the organisation that faces the decision. Then keep the protagonist in that seat and give them the team's role and job title. The route into the case stands as it is. Take case A whenever the team's practice context names a department or a function that the organisation facing the decision could itself have, such as a treasury, a finance team, a marketing department or a social work team inside it. Prefer case A when either case could be argued.`,
    `Case B. Someone with the team's role could not hold that seat, because the work, the client group or the mandate belongs elsewhere. Then do this in three steps.`,
    `  1. Leave the organisation that faces the decision exactly as the original has it: the same name, the same sector, the same figures and the same people. Do not adjust its name towards the team's sector, and do not change one letter of it.`,
    `  2. Make the protagonist a worker with the team's role, employed by an organisation of the team's kind, and give that organisation a name of its own, as a real firm or agency would have. Do not write "a retail banking firm" or "a corporate treasury firm"; name it and say in three or four words what it does.`,
    `  3. Rewrite only the one or two sentences that bring the protagonist into the case, and have them state the working relationship between the two organisations: adviser, lender, investor, auditor, supplier, client, referring agency or partner agency. Pick the relationship an organisation of the team's kind would really have with this organisation over this decision. A bank asked about an equipment purchase is the lender or the financing bank, not a general advisory firm. Name no new person in those sentences: the people in them are the people the original names, or are referred to by role. For example, ${pack.variantEntryExample}.`,
    `In case B, read every later sentence that addresses the protagonist as an insider. If the original says that the organisation's CFO or manager "has tasked you", the bridging sentences must make that instruction plausible from outside, for instance by writing that the CFO has engaged your firm and asked you to prepare the analysis. The CFO is still the person doing the asking, and "you" is still the protagonist. Adjust such a sentence only as far as the protagonist's new standing requires.`,
    `The organisation, the people, the facts, the figures, the timeline and the decision all stay as they are. Only the protagonist and the route in change.`,
    ``,
    `## Change only these`,
    `- The protagonist's role and job title, and the organisation that employs the protagonist, under the rule above.`,
    `- The vantage point from which the team looks at the decision.`,
    `- The one or two sentences that carry the route into the case, and any later sentence whose form of address depends on the protagonist's standing, in case B only.`,
    `- Wording that follows from those changes: job titles and the names of the protagonist's own working documents.`,
    ``,
    `## Keep these exactly as they are in the original`,
    `- The organisation that faces the decision: its name, its sector, its size, its figures and the people in it. Never replace it, rename it, or move it to the team's sector. A packaging manufacturer stays a packaging manufacturer even for a banking team; the banking team supplies the protagonist, not the organisation.`,
    `- The personal names, gender, age and honorifics of everyone named in the original, including the client, the family members and the protagonist. Change a person's name only if the new setting makes it impossible to keep, and never as decoration.`,
    `- The cast. Introduce no new named person anywhere in the variant: every name in it is a name the original uses. Where the route into the case needs someone the original does not name, refer to them by their role, such as "the finance director", "the duty manager" or "the referring worker", and give them no name at all.`,
    `- The task the learner is asked to carry out. If the original values something, the variant values something; if it recommends, the variant recommends.`,
    `- The kind of entity being analysed. A bank stays a bank, a REIT stays a REIT, a hospital stays a hospital. The team's own practice context sets the vantage point, not the subject: a corporate-treasury team still analyses a bank if the original does.`,
    `- Every number in the original scenario, and every data block or table, with the same labels and the same values. Carry a data block across in full, including figures an instructor added by hand.`,
    `- The currency and the country. The team's profile never moves the case to another country or converts its figures.`,
    `- The number of discussion questions, their order, and what each one asks, including the organisation each one names. The variant's third question asks what the original's third question asks.`,
    `- The must-cover concepts, in the same words the original uses.`,
    `- The rubric's criteria and their weights; only the wording may follow the new context.`,
    ``,
    `Do not introduce a regulation, limit, or institution that the original does not`,
    `mention. If a rule in the original is specific to its country and the setting`,
    `has moved, keep the rule and name it as it stands in the original.`,
    ``,
    ...(note ? [`## Instructor's note for this redraft`, note, ``] : []),
    `## Rule for the model answers`,
    MODEL_ANSWER_RULE,
    ``,
    `## Original case content (the structure to preserve)`,
    // Delimited with plain rules rather than Markdown headings: models copied a
    // "### Scenario" heading into the scenario field, which then rendered as a
    // doubled heading on the student page.
    `--- ORIGINAL SCENARIO ---`,
    base.scenario,
    `--- END ORIGINAL SCENARIO ---`,
    ``,
    `--- ORIGINAL DISCUSSION QUESTIONS (${base.discussionQuestions.length}) ---`,
    base.discussionQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    ``,
    `--- ORIGINAL MODEL ANSWERS ---`,
    base.modelAnswers.map((a, i) => `${i + 1}. ${a}`).join("\n"),
    ``,
    `--- ORIGINAL RUBRIC ---`,
    base.rubric,
    ``,
    `--- ORIGINAL KEY TERMS ---`,
    (base.glossary ?? []).map((g) => `${g.term}: ${g.definition}`).join("\n") ||
      "(none)",
    ``,
    `Output the variant in the same structured shape, with the same number of`,
    `questions and answers. The scenario field holds the scenario text only: no`,
    `heading, no "Scenario:" label.`,
  ].join("\n");

  const { object } = await generateObject({
    model: getGenerationModel(),
    schema: GenerationOutputSchema,
    system: pack.systemPrompt,
    prompt: userPrompt,
    // Lower than the master draft. A variant is a controlled rewrite of an
    // approved case, so fidelity to the original matters more than variety.
    temperature: 0.5,
    maxTokens,
  });

  return { schemaVersion: 1, ...normalizeOutput(object) };
}
