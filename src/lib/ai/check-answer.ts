import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { EQUIVALENCE_SYSTEM_PROMPT, FEEDBACK_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  assertNeverFormat,
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
  switch (content.format) {
    case "mcq":
      return {
        correct:
          typeof submitted === "string" &&
          submitted.trim().toUpperCase() === answer.correct_choice_id,
        method: "local",
      };

    case "multi_select": {
      // Set equality, so a student who picks a true statement but misses
      // another is wrong — which is the point of the format.
      const picked = new Set(submittedIds(submitted));
      const truth = new Set(answer.correct_choice_ids ?? []);
      return {
        correct: picked.size === truth.size && [...truth].every((id) => picked.has(id)),
        method: "local",
      };
    }

    case "ordering": {
      const order = submittedIds(submitted);
      const truth = answer.correct_order ?? [];
      return {
        correct: order.length === truth.length && order.every((id, i) => id === truth[i]),
        method: "local",
      };
    }

    case "fill_blank": {
      const values = (submitted ?? {}) as Record<string, string>;
      for (const blank of answer.blanks ?? []) {
        const student = values[String(blank.index)] ?? "";
        const res = blank.answer.multi_valued
          ? checkMultiAnswer(student, blank.answer)
          : checkOpenAnswer(student, blank.answer);
        if (res === "incorrect") return { correct: false, method: "local" };
        if (res === "uncertain") {
          const eq = await aiEquivalent(
            student,
            blank.answer.value_latex,
            blank.answer.acceptable_forms
          );
          if (!eq) return { correct: false, method: "ai" };
        }
      }
      return { correct: true, method: "local" };
    }

    case "open": {
      const student = String(submitted ?? "");
      const canonical = answer.answer;
      if (!canonical) return { correct: false, method: "local" };
      const res = canonical.multi_valued
        ? checkMultiAnswer(student, canonical)
        : checkOpenAnswer(student, canonical);
      if (res !== "uncertain") return { correct: res === "correct", method: "local" };
      const eq = await aiEquivalent(student, canonical.value_latex, canonical.acceptable_forms);
      return { correct: eq, method: "ai" };
    }

    default:
      return assertNeverFormat(content.format);
  }
}

/** Choice ids off the wire, which arrive as an array of letters. */
function submittedIds(submitted: unknown): string[] {
  if (!Array.isArray(submitted)) return [];
  return submitted
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().toUpperCase());
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
  const rationaleFor = (id: string) =>
    answer.distractor_rationales?.find((d) => d.choice_id === id)?.misconception;

  let answerDesc: string;
  switch (content.format) {
    case "mcq": {
      const correct = content.choices?.find((c) => c.id === answer.correct_choice_id);
      answerDesc = `Correct choice: ${answer.correct_choice_id}) ${correct?.latex}`;
      const pickedId = String(submitted).trim().toUpperCase();
      const why = rationaleFor(pickedId);
      if (why) {
        answerDesc += `\nThe student picked choice ${pickedId}, whose authored misconception is: ${why}`;
      }
      break;
    }
    case "multi_select": {
      // Over-picking and under-picking are different errors and deserve
      // different advice, so name them separately rather than as one miss.
      const truth = answer.correct_choice_ids ?? [];
      const picked = submittedIds(submitted);
      const over = picked.filter((id) => !truth.includes(id));
      const missed = truth.filter((id) => !picked.includes(id));
      answerDesc = `Correct selection: ${truth.join(", ") || "(none)"}. The student selected: ${
        picked.join(", ") || "(nothing)"
      }.`;
      if (over.length > 0) {
        answerDesc += `\nWrongly selected ${over.join(", ")} — authored misconceptions: ${over
          .map((id) => `${id}: ${rationaleFor(id) ?? "unrecorded"}`)
          .join(" | ")}`;
      }
      if (missed.length > 0) {
        answerDesc += `\nFailed to select ${missed.join(", ")}, which are correct.`;
      }
      break;
    }
    case "ordering": {
      const byId = new Map((content.items ?? []).map((i) => [i.id, i.latex]));
      const truth = answer.correct_order ?? [];
      answerDesc = `Correct order: ${truth
        .map((id, i) => `${i + 1}. ${id}) ${byId.get(id) ?? ""}`)
        .join("  ")}\nThe student's order: ${submittedIds(submitted).join(" -> ") || "(none)"}`;
      break;
    }
    case "open":
      answerDesc = `Correct answer: ${answer.answer?.value_latex}`;
      break;
    case "fill_blank":
      answerDesc = `Correct blanks: ${(answer.blanks ?? [])
        .map((b) => `{{${b.index}}} = ${b.answer.value_latex}`)
        .join(", ")}`;
      break;
    default:
      return assertNeverFormat(content.format);
  }

  const optionList = content.choices ?? content.items;

  return callStructured({
    models: CHECKER_MODELS,
    system: FEEDBACK_SYSTEM_PROMPT,
    prompt: `Problem: ${content.statement_latex}
${optionList ? `Options:\n${optionList.map((c) => `${c.id}) ${c.latex}`).join("\n")}` : ""}
${answerDesc}
Solution steps:
${explanation.steps.map((s, i) => `${i + 1}. ${s.latex} — ${s.note}`).join("\n")}

Student's answer: ${JSON.stringify(submitted)}`,
    schema: FeedbackResultSchema,
    maxOutputTokens: 3000,
  });
}
