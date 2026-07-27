import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { EQUIVALENCE_SYSTEM_PROMPT, FEEDBACK_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  EquivalenceResultSchema,
  FeedbackResultSchema,
  type FeedbackResult,
  type ProblemAnswerRecord,
  type ProblemContentRecord,
  type ProblemExplanationRecord,
} from "@/lib/ai/schemas";
import { checkMultiAnswer, checkOpenAnswer } from "@/lib/answers";

export type CheckOutcome = {
  correct: boolean;
  /** How the answer was decided. */
  method: "local" | "ai";
};

/** Decide whether a submitted answer is correct, using AI only when local comparison is inconclusive. */
export async function checkSubmission(
  content: ProblemContentRecord,
  answer: ProblemAnswerRecord,
  submitted: unknown
): Promise<CheckOutcome> {
  if (content.format === "mcq") {
    return {
      correct:
        typeof submitted === "string" &&
        submitted.trim().toUpperCase() === answer.correct_choice_id,
      method: "local",
    };
  }

  if (content.format === "fill_blank") {
    const values = (submitted ?? {}) as Record<string, string>;
    for (const blank of answer.blanks ?? []) {
      const student = values[String(blank.index)] ?? "";
      const res = blank.answer.multi_valued
        ? checkMultiAnswer(student, blank.answer)
        : checkOpenAnswer(student, blank.answer);
      if (res === "incorrect") return { correct: false, method: "local" };
      if (res === "uncertain") {
        const eq = await aiEquivalent(student, blank.answer.value_latex);
        if (!eq) return { correct: false, method: "ai" };
      }
    }
    return { correct: true, method: "local" };
  }

  // open
  const student = String(submitted ?? "");
  const canonical = answer.answer!;
  const res = canonical.multi_valued
    ? checkMultiAnswer(student, canonical)
    : checkOpenAnswer(student, canonical);
  if (res !== "uncertain") return { correct: res === "correct", method: "local" };
  const eq = await aiEquivalent(student, canonical.value_latex, canonical.acceptable_forms);
  return { correct: eq, method: "ai" };
}

async function aiEquivalent(
  student: string,
  reference: string,
  acceptableForms: string[] = []
): Promise<boolean> {
  const result = await callStructured({
    models: CHECKER_MODELS,
    system: EQUIVALENCE_SYSTEM_PROMPT,
    prompt: `Reference answer (LaTeX): ${reference}${acceptableForms.length ? `\nAlso acceptable: ${acceptableForms.join(" ; ")}` : ""}\nStudent's answer: ${student}`,
    schema: EquivalenceResultSchema,
    maxOutputTokens: 2000,
  });
  return result?.equivalent ?? false;
}

/** Diagnose a wrong answer: what the student probably did wrong. */
export async function wrongAnswerFeedback(
  content: ProblemContentRecord,
  answer: ProblemAnswerRecord,
  explanation: ProblemExplanationRecord,
  submitted: unknown
): Promise<FeedbackResult | null> {
  let answerDesc = "";
  if (content.format === "mcq") {
    const correct = content.choices?.find((c) => c.id === answer.correct_choice_id);
    answerDesc = `Correct choice: ${answer.correct_choice_id}) ${correct?.latex}`;
    const picked = answer.distractor_rationales?.find(
      (d) => d.choice_id === String(submitted).trim().toUpperCase()
    );
    if (picked) {
      answerDesc += `\nThe student picked choice ${picked.choice_id}, whose authored misconception is: ${picked.misconception}`;
    }
  } else if (content.format === "open") {
    answerDesc = `Correct answer: ${answer.answer?.value_latex}`;
  } else {
    answerDesc = `Correct blanks: ${(answer.blanks ?? [])
      .map((b) => `{{${b.index}}} = ${b.answer.value_latex}`)
      .join(", ")}`;
  }

  return callStructured({
    models: CHECKER_MODELS,
    system: FEEDBACK_SYSTEM_PROMPT,
    prompt: `Problem: ${content.statement_latex}
${content.choices ? `Choices:\n${content.choices.map((c) => `${c.id}) ${c.latex}`).join("\n")}` : ""}
${answerDesc}
Solution steps:
${explanation.steps.map((s, i) => `${i + 1}. ${s.latex} — ${s.note}`).join("\n")}

Student's answer: ${JSON.stringify(submitted)}`,
    schema: FeedbackResultSchema,
    maxOutputTokens: 3000,
  });
}
