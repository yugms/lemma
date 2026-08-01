import type { GeneratedProblem } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";
import type { Template } from "@/lib/templates/types";
import {
  buildChoices,
  buildOrdering,
  numericAnswer,
  signedTerm,
  term,
} from "@/lib/templates/helpers";

/**
 * Multi-step linear equations with integer solutions.
 * d1: a(x + b) = c
 * d2: ax + b = cx + d (variables on both sides)
 * d3: a(x + b) + c = dx + e (distribution + both sides)
 */
export const linearEquations: Template = {
  id: "multi-step-linear",
  topicSlugs: ["multi-step-linear"],
  // The worked steps are already in order, so an ordering problem is free —
  // and solving-order is exactly what this topic is about.
  formats: ["open", "mcq", "ordering"],
  difficulties: [1, 3],
  generate(rng: Rng, difficulty: number, format): GeneratedProblem {
    const x = rng.nonZeroInt(-9, 9);

    let statement: string;
    let steps: { latex: string; note: string }[];

    if (difficulty === 1) {
      const a = rng.nonZeroInt(2, 6);
      const b = rng.nonZeroInt(-8, 8);
      const c = a * (x + b);
      statement = `Solve for \\(x\\): \\[${a}(x${signedTerm(b)}) = ${c}\\]`;
      steps = [
        { latex: `${a}(x${signedTerm(b)}) = ${c}`, note: "Start with the original equation." },
        { latex: `x${signedTerm(b)} = ${c / a}`, note: `Divide both sides by ${a}.` },
        { latex: `x = ${x}`, note: `${b > 0 ? "Subtract" : "Add"} ${Math.abs(b)} ${b > 0 ? "from" : "to"} both sides.` },
      ];
    } else if (difficulty === 2) {
      const a = rng.nonZeroInt(2, 7);
      let c = rng.nonZeroInt(-5, 5);
      while (a === c) c = rng.nonZeroInt(-5, 5);
      const b = rng.nonZeroInt(-9, 9);
      const d = (a - c) * x + b;
      statement = `Solve for \\(x\\): \\[${term(a, "x")}${signedTerm(b)} = ${term(c, "x")}${signedTerm(d)}\\]`;
      steps = [
        { latex: `${term(a, "x")}${signedTerm(b)} = ${term(c, "x")}${signedTerm(d)}`, note: "Start with the original equation." },
        {
          latex: `${term(a - c, "x")}${signedTerm(b)} = ${d}`,
          note: `${c > 0 ? "Subtract" : "Add"} \\(${term(Math.abs(c), "x")}\\) ${c > 0 ? "from" : "to"} both sides to collect the variable terms.`,
        },
        { latex: `${term(a - c, "x")} = ${d - b}`, note: `${b > 0 ? "Subtract" : "Add"} ${Math.abs(b)} ${b > 0 ? "from" : "to"} both sides.` },
        { latex: `x = ${x}`, note: `Divide both sides by ${a - c}.` },
      ];
    } else {
      const a = rng.nonZeroInt(2, 5);
      const b = rng.nonZeroInt(-6, 6);
      const c = rng.nonZeroInt(-9, 9);
      let d = rng.nonZeroInt(-5, 5);
      while (d === a) d = rng.nonZeroInt(-5, 5);
      const e = a * x + a * b + c - d * x;
      statement = `Solve for \\(x\\): \\[${a}(x${signedTerm(b)})${signedTerm(c)} = ${term(d, "x")}${signedTerm(e)}\\]`;
      steps = [
        { latex: `${a}(x${signedTerm(b)})${signedTerm(c)} = ${term(d, "x")}${signedTerm(e)}`, note: "Start with the original equation." },
        { latex: `${term(a, "x")}${signedTerm(a * b)}${signedTerm(c)} = ${term(d, "x")}${signedTerm(e)}`, note: `Distribute the ${a}.` },
        { latex: `${term(a, "x")}${signedTerm(a * b + c)} = ${term(d, "x")}${signedTerm(e)}`, note: "Combine the constants on the left." },
        { latex: `${term(a - d, "x")} = ${e - a * b - c}`, note: "Move all variable terms to one side and constants to the other." },
        { latex: `x = ${x}`, note: `Divide both sides by ${a - d}.` },
      ];
    }

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint: difficulty === 1 ? "Undo the operations one at a time — divide first." : "Collect the variable terms on one side and constants on the other.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(rng, `${x}`, [
        { latex: `${-x}`, misconception: "Sign error when moving a term across the equals sign." },
        { latex: `${x + rng.pick([1, 2, -2])}`, misconception: "Arithmetic slip when combining constants." },
        { latex: `${x * 2}`, misconception: "Multiplied instead of dividing in the final step." },
      ]);
      return { ...base, format: "mcq", ...mc };
    }

    if (format === "ordering") {
      return {
        ...base,
        statement_latex: `Put the steps of this solution in the right order: \\[${statement.replace(/^Solve for \\\(x\\\): \\\[/, "").replace(/\\\]$/, "")}\\]`,
        format: "ordering",
        ...buildOrdering(rng, steps),
      };
    }

    return { ...base, format: "open", answer: numericAnswer(x, `x = ${x}`) };
  },
};
