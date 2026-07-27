import { callStructured, GENERATOR_MODELS } from "@/lib/ai/provider";
import { GENERATOR_SYSTEM_PROMPT, REPAIR_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  batchSchemaFor,
  repairSchemaFor,
  type GeneratedProblem,
  type ProblemFormat,
  type ProblemStyle,
  type SolverResult,
  type TaggedProblem,
} from "@/lib/ai/schemas";

export type TopicInfo = {
  id: string;
  title: string;
  description: string | null;
  unit_title?: string;
  course_title?: string;
};

export type GenerationRequest = {
  topics: TopicInfo[];
  count: number;
  difficulty: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  avoid: string[]; // statement snippets of problems already in the set
};

const MAX_PER_CALL = 6;

const FORMAT_BRIEF: Record<ProblemFormat, string> = {
  mcq: "multiple choice: 4-5 choices, exactly one correct, every distractor traceable to a specific misconception",
  open: "open answer: the student types the answer, so give a canonical form plus every acceptable alternate form",
  fill_blank:
    "fill in the blank: put {{1}}, {{2}}, ... placeholders in the statement and answer each one",
};

function buildUserMessage(
  req: GenerationRequest,
  format: ProblemFormat,
  count: number,
  avoid: string[]
): string {
  const topicLines = req.topics
    .map(
      (t, i) =>
        `[${i}] ${t.course_title ? `${t.course_title} / ` : ""}${t.unit_title ? `${t.unit_title} / ` : ""}${t.title}${t.description ? `: ${t.description}` : ""}`
    )
    .join("\n");

  const avoidBlock =
    avoid.length > 0
      ? `\n\nDo NOT produce problems similar to any of these (already in this set):\n${avoid
          .map((a) => `- ${a.slice(0, 160)}`)
          .join("\n")}`
      : "";

  return `Author ${count} new problem${count === 1 ? "" : "s"}.

Topics (distribute problems across these; set each problem's topic_index to the
bracketed number of the topic it actually tests):
${topicLines}

Requirements:
- Format: ${format} — ${FORMAT_BRIEF[format]}
- Difficulty: ${req.difficulty} (per the rubric)
- Allowed styles: ${req.styles.join(", ")} (distribute across them)${avoidBlock}`;
}

/** Spread a count across the requested formats as evenly as possible. */
function splitAcrossFormats(count: number, formats: ProblemFormat[]): Map<ProblemFormat, number> {
  const plan = new Map<ProblemFormat, number>();
  formats.forEach((f, i) => {
    plan.set(f, Math.floor(count / formats.length) + (i < count % formats.length ? 1 : 0));
  });
  return plan;
}

/**
 * Generate up to `req.count` problems, one batched call per format (and per
 * MAX_PER_CALL chunk within a format). Returns whatever came back validated —
 * shortfalls are the caller's to deal with.
 */
export async function generateProblems(
  req: GenerationRequest
): Promise<TaggedProblem[]> {
  const results: TaggedProblem[] = [];

  for (const [format, wanted] of splitAcrossFormats(req.count, req.formats)) {
    let remaining = wanted;
    while (remaining > 0) {
      const n = Math.min(remaining, MAX_PER_CALL);
      const batch = await callStructured({
        models: GENERATOR_MODELS,
        system: GENERATOR_SYSTEM_PROMPT,
        prompt: buildUserMessage(req, format, n, [
          ...req.avoid,
          ...results.map((p) => p.statement_latex),
        ]),
        schema: batchSchemaFor(format),
        maxOutputTokens: 30000,
        thinking: "medium",
        budgetMs: 150_000, // authoring a batch is the longest call we make
      });
      remaining -= n;
      if (!batch) break; // model gave up on this format; keep the other formats
      // Clamp rather than discard: a bogus index is a tagging slip, not a bad problem.
      results.push(
        ...batch.problems.map((p) => ({
          ...p,
          topic_index: Math.min(Math.max(p.topic_index, 0), req.topics.length - 1),
        }))
      );
    }
  }

  return results;
}

/** One repair attempt for a problem that failed verification. */
export async function repairProblem(
  problem: GeneratedProblem,
  solver: SolverResult
): Promise<GeneratedProblem | null> {
  const result = await callStructured({
    models: GENERATOR_MODELS,
    system: REPAIR_SYSTEM_PROMPT,
    prompt: `Problem (as authored, JSON):
${JSON.stringify(problem, null, 2)}

Independent solver's result:
- final answer: ${solver.final_answer_latex}
- chosen choice: ${solver.chosen_choice_id ?? "n/a"}
- well-posed: ${solver.is_well_posed}${solver.issue ? `\n- issue: ${solver.issue}` : ""}
- reasoning: ${solver.reasoning_summary}`,
    schema: repairSchemaFor(problem.format),
    maxOutputTokens: 16000,
    thinking: "medium",
    budgetMs: 70_000,
  });
  return result?.fixed_problem ?? null;
}
