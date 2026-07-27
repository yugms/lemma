import type { GeneratedProblem } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";
import type { Template } from "@/lib/templates/types";
import { buildChoices, expressionAnswer, signedTerm, term } from "@/lib/templates/helpers";

/**
 * 2x2 linear systems with integer solutions.
 * d1: one equation has a lone variable (substitution-ready)
 * d2-3: general elimination with small multipliers
 */
export const linearSystems: Template = {
  id: "linear-systems-2x2",
  topicSlugs: ["systems-2x2"],
  formats: ["open", "mcq"],
  difficulties: [1, 3],
  generate(rng: Rng, difficulty: number, format): GeneratedProblem {
    const x = rng.nonZeroInt(-6, 6);
    const y = rng.nonZeroInt(-6, 6);

    let a1: number, b1: number, a2: number, b2: number;
    if (difficulty === 1) {
      // y isolated in eq2: y = a2 x + k form -> write as -a2 x + y = c2
      a1 = rng.nonZeroInt(2, 4);
      b1 = rng.pick([1, -1, 2]);
      a2 = -rng.nonZeroInt(1, 3);
      b2 = 1;
    } else {
      a1 = rng.nonZeroInt(-4, 4);
      b1 = rng.nonZeroInt(-4, 4);
      do {
        a2 = rng.nonZeroInt(-4, 4);
        b2 = rng.nonZeroInt(-4, 4);
      } while (a1 * b2 - a2 * b1 === 0); // ensure a unique solution
    }
    const c1 = a1 * x + b1 * y;
    const c2 = a2 * x + b2 * y;

    const eq1 = `${term(a1, "x")}${signedTerm(b1, "y")} = ${c1}`;
    const eq2 = `${term(a2, "x")}${signedTerm(b2, "y")} = ${c2}`;
    const statement = `Solve the system: \\[\\begin{cases}${eq1}\\\\ ${eq2}\\end{cases}\\]`;

    // Elimination narrative: eliminate y using multipliers b2 and -b1
    const m1 = b2;
    const m2 = -b1;
    const ex = m1 * a1 + m2 * a2; // coefficient of x after elimination
    const ec = m1 * c1 + m2 * c2;

    const steps = [
      { latex: `\\begin{cases}${eq1}\\\\ ${eq2}\\end{cases}`, note: "Write the system clearly." },
      {
        latex: `${m1 === 1 ? "" : `(${m1})\\times\\text{eq}_1`}${m1 === 1 ? "\\text{eq}_1" : ""} ${m2 >= 0 ? "+" : "+"} (${m2})\\times\\text{eq}_2`,
        note: `Multiply the equations by ${m1} and ${m2} so the \\(y\\)-terms cancel, then add.`,
      },
      {
        latex: `${term(ex, "x")} = ${ec}`,
        note: "The y-terms cancel, leaving one equation in x.",
      },
      { latex: `x = ${x}`, note: "Divide both sides to solve for x." },
      {
        latex: `${term(a1, "x")}${signedTerm(b1, "y")} = ${c1} \\Rightarrow ${term(b1, "y")} = ${c1 - a1 * x} \\Rightarrow y = ${y}`,
        note: "Substitute x back into the first equation and solve for y.",
      },
      { latex: `(x, y) = (${x}, ${y})`, note: "State the solution as an ordered pair." },
    ];

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint:
        difficulty === 1
          ? "Solve one equation for a variable, then substitute into the other."
          : "Multiply the equations so one variable's coefficients are opposites, then add.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(rng, `(${x}, ${y})`, [
        { latex: `(${y}, ${x})`, misconception: "Swapped the x and y values in the ordered pair." },
        { latex: `(${-x}, ${y === 0 ? 1 : -y})`, misconception: "Sign error while eliminating a variable." },
        { latex: `(${x + (b1 !== 0 ? Math.sign(b1) : 1)}, ${y - 1})`, misconception: "Arithmetic slip when back-substituting." },
      ]);
      return { ...base, format: "mcq", ...mc };
    }

    return {
      ...base,
      format: "open",
      answer: expressionAnswer(`(${x}, ${y})`, [`x=${x}, y=${y}`, `x=${x},y=${y}`, `${x}, ${y}`]),
    };
  },
};
