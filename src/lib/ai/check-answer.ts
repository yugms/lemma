import { callStructured, CHECKER_MODELS } from "@/lib/ai/provider";
import { FEEDBACK_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { askModelIfEquivalent, notEquivalentWithoutAsking } from "@/lib/ai/equivalence";
import {
  assertNeverFormat,
  FeedbackResultSchema,
  type FeedbackResult,
  type ProblemAnswerRecord,
  type ProblemContentRecord,
  type ProblemExplanationRecord,
} from "@/lib/ai/schemas";
import { checkMultiAnswer, checkOpenAnswer } from "@/lib/answers";
import {
  curveFromAuthored,
  curvesMatch,
  plotFromSpec,
  pointsMatch,
  type PlotCurve,
} from "@/lib/plot";

export type CheckMethod = "local" | "ai";

export type CheckOutcome = {
  correct: boolean;
  /** How the answer was decided. */
  method: CheckMethod;
};

/**
 * Decide whether a submitted answer is correct, using AI only when local
 * comparison is inconclusive.
 *
 * `allowAi: false` grades entirely locally, which the daily grading budget uses
 * when a user has spent theirs. An inconclusive answer then resolves to
 * incorrect — the same outcome `aiEquivalent` already produces when the
 * provider is unreachable (it returns `false` rather than throwing), so this is
 * an existing degradation being reached deliberately rather than a new rule.
 * The budget is set well above ordinary practice for exactly that reason.
 */
export async function checkSubmission(
  content: ProblemContentRecord,
  answer: ProblemAnswerRecord,
  submitted: unknown,
  { allowAi = true }: { allowAi?: boolean } = {}
): Promise<CheckOutcome> {
  const aiEquivalent = allowAi ? askModelIfEquivalent : notEquivalentWithoutAsking;
  // Reported honestly: with no budget left nothing was asked, so the verdict
  // came from local comparison however it reads.
  const escalationMethod = allowAi ? "ai" : "local";

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
          if (!eq) return { correct: false, method: escalationMethod };
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
      return { correct: eq, method: escalationMethod };
    }

    case "matching": {
      // Submitted as { leftId: rightId }. Every left item must be paired, and
      // paired correctly — there is no partial credit, same as fill_blank.
      const picked = submittedPairs(submitted);
      const truth = answer.correct_pairs ?? [];
      return {
        correct:
          truth.length > 0 &&
          picked.size === truth.length &&
          truth.every((pair) => picked.get(pair.left_id) === pair.right_id),
        method: "local",
      };
    }

    case "multi_part": {
      // Submitted as { label: typed }. Mirrors fill_blank exactly, including
      // the escalation to an equivalence call on an inconclusive part.
      const values = (submitted ?? {}) as Record<string, string>;
      const parts = answer.parts ?? [];
      if (parts.length === 0) return { correct: false, method: "local" };
      let usedAi = false;
      for (const part of parts) {
        const student = values[part.label] ?? "";
        const res = part.answer.multi_valued
          ? checkMultiAnswer(student, part.answer)
          : checkOpenAnswer(student, part.answer);
        if (res === "incorrect") return { correct: false, method: usedAi ? escalationMethod : "local" };
        if (res === "uncertain") {
          usedAi = true;
          const eq = await aiEquivalent(
            student,
            part.answer.value_latex,
            part.answer.acceptable_forms
          );
          if (!eq) return { correct: false, method: escalationMethod };
        }
      }
      return { correct: true, method: usedAi ? escalationMethod : "local" };
    }

    case "graph": {
      switch (content.response_kind) {
        case "value": {
          const student = String(submitted ?? "");
          const canonical = answer.answer;
          if (!canonical) return { correct: false, method: "local" };
          const res = canonical.multi_valued
            ? checkMultiAnswer(student, canonical)
            : checkOpenAnswer(student, canonical);
          if (res !== "uncertain") return { correct: res === "correct", method: "local" };
          const eq = await aiEquivalent(
            student,
            canonical.value_latex,
            canonical.acceptable_forms
          );
          return { correct: eq, method: escalationMethod };
        }
        case "points":
          // Both sides are lattice points by construction, so this is exact —
          // no model call, and no tolerance to argue about.
          return {
            correct: pointsMatch(submittedPoints(submitted), answer.correct_points ?? []),
            method: "local",
          };
        case "sketch": {
          const target = answer.target_curve ? curveFromAuthored(answer.target_curve) : null;
          const drawn = submittedCurve(submitted);
          const plot = content.plot ? plotFromSpec(content.plot) : null;
          if (!target || !drawn || !plot) return { correct: false, method: "local" };
          // Handles land on the lattice, so an exactly-positioned curve matches
          // exactly; the tolerance only absorbs float error in the fit.
          return {
            correct: curvesMatch(drawn, target, plot.window, 1e-6),
            method: "local",
          };
        }
        default:
          return { correct: false, method: "local" };
      }
    }

    default:
      return assertNeverFormat(content.format);
  }
}

/** Selected points off the wire: `[{x, y}, ...]`, with anything malformed dropped. */
function submittedPoints(submitted: unknown): { x: number; y: number }[] {
  if (!Array.isArray(submitted)) return [];
  return submitted.flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const { x, y } = p as { x?: unknown; y?: unknown };
    return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
      ? [{ x, y }]
      : [];
  });
}

/** A sketched curve off the wire, in the same coefficient form as the key. */
function submittedCurve(submitted: unknown): PlotCurve | null {
  if (!submitted || typeof submitted !== "object") return null;
  const { kind, coeffs } = submitted as { kind?: unknown; coeffs?: unknown };
  if (typeof kind !== "string" || !Array.isArray(coeffs)) return null;
  if (!coeffs.every((c) => typeof c === "number")) return null;
  return curveFromAuthored({ kind, coeffs: coeffs as number[] });
}

/** Matching answers off the wire: `{ leftId: rightId }`, normalized. */
function submittedPairs(submitted: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!submitted || typeof submitted !== "object" || Array.isArray(submitted)) return out;
  for (const [left, right] of Object.entries(submitted as Record<string, unknown>)) {
    if (typeof right !== "string" || right.trim() === "") continue;
    out.set(left.trim().toUpperCase(), right.trim());
  }
  return out;
}

/** Choice ids off the wire, which arrive as an array of letters. */
function submittedIds(submitted: unknown): string[] {
  if (!Array.isArray(submitted)) return [];
  return submitted
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().toUpperCase());
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
    case "matching": {
      // Which pairs were wrong is the whole diagnosis here — a student who
      // swapped two entries has a different confusion from one who guessed.
      const leftText = new Map((content.left ?? []).map((l) => [l.id, l.latex]));
      const rightText = new Map((content.right ?? []).map((r) => [r.id, r.latex]));
      const picked = submittedPairs(submitted);
      const truth = answer.correct_pairs ?? [];
      answerDesc = `Correct pairing:\n${truth
        .map(
          (pair) =>
            `  ${pair.left_id}) ${leftText.get(pair.left_id) ?? ""} -> ${pair.right_id}) ${
              rightText.get(pair.right_id) ?? ""
            }`
        )
        .join("\n")}`;
      const wrong = truth.filter((pair) => picked.get(pair.left_id) !== pair.right_id);
      answerDesc += `\nThe student's pairing: ${
        truth.map((pair) => `${pair.left_id}->${picked.get(pair.left_id) ?? "?"}`).join(", ") ||
        "(none)"
      }`;
      if (wrong.length > 0) {
        answerDesc += `\nMispaired: ${wrong.map((pair) => pair.left_id).join(", ")}`;
      }
      break;
    }
    case "multi_part": {
      // Name the first failed part: in a chain, an error in (a) propagates, and
      // diagnosing (c) when (a) is the cause teaches the wrong lesson.
      const values = (submitted ?? {}) as Record<string, string>;
      answerDesc = `Correct answers by part:\n${(answer.parts ?? [])
        .map((part) => `  (${part.label}) ${part.answer.value_latex}`)
        .join("\n")}`;
      answerDesc += `\nThe student's answers: ${(answer.parts ?? [])
        .map((part) => `(${part.label}) ${values[part.label] || "(blank)"}`)
        .join(", ")}`;
      answerDesc += `\nParts build on each other — if an early part is wrong, say so first; a later part may be consistent with their own earlier error.`;
      break;
    }
    case "graph": {
      const w = content.plot;
      const where = w
        ? `The plot shows x from ${w.x_min} to ${w.x_max}, y from ${w.y_min} to ${w.y_max}${
            w.curves.length
              ? `, with ${w.curves.map((c) => `${c.kind}(${c.coeffs.join(", ")})`).join("; ")}`
              : ""
          }.`
        : "";
      if (content.response_kind === "points") {
        answerDesc = `${where}\nCorrect points: ${(answer.correct_points ?? [])
          .map((p) => `(${p.x}, ${p.y})`)
          .join(", ")}\nThe student selected: ${
          submittedPoints(submitted)
            .map((p) => `(${p.x}, ${p.y})`)
            .join(", ") || "(nothing)"
        }`;
      } else if (content.response_kind === "sketch") {
        answerDesc = `${where}\nTarget curve: ${
          answer.target_curve
            ? `${answer.target_curve.kind}(${answer.target_curve.coeffs.join(", ")})`
            : "(unrecorded)"
        }\nThe student drew: ${JSON.stringify(submitted)}`;
      } else {
        answerDesc = `${where}\nCorrect answer: ${answer.answer?.value_latex}`;
      }
      break;
    }
    default:
      return assertNeverFormat(content.format);
  }

  const optionList = content.choices ?? content.items;

  return callStructured({
    models: CHECKER_MODELS,
    label: "feedback",
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
