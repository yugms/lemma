import type { GeneratedProblem, ProblemFormat } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";
import type { Template } from "@/lib/templates/types";
import {
  buildChoices,
  buildOrdering,
  fractionLatex,
  multiValueAnswer,
  quadraticLatex,
  signedTerm,
  simplifyRadical,
  term,
} from "@/lib/templates/helpers";

/**
 * Solve quadratic equations.
 * d1-2: leading coeff 1, integer roots (factoring)
 * d3:   leading coeff 2-3, rational roots
 * d4-5: irrational roots via the quadratic formula (simplified radical form)
 */
export const quadraticSolving: Template = {
  id: "quadratic-solving",
  topicSlugs: ["quadratic-solving", "solving-quadratics-intro", "factoring-quadratics"],
  formats: ["open", "mcq", "ordering"],
  difficulties: [1, 5],
  generate(rng: Rng, difficulty: number, format): GeneratedProblem {
    if (difficulty <= 3) return rationalRoots(rng, difficulty, format);
    return irrationalRoots(rng, difficulty, format);
  },
};

function rationalRoots(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
  const a = difficulty <= 2 ? 1 : rng.pick([2, 3]);
  // roots p/a and q (keep one integer root when a > 1 for clean factoring)
  const range = difficulty === 1 ? 6 : 9;
  const p = rng.nonZeroInt(-range, range);
  let q = rng.nonZeroInt(-range, range);
  if (difficulty >= 2 && p === q) q = -q; // prefer distinct roots at d2+
  // (a x - p)(x - q) = a x^2 - (aq + p) x + pq
  const b = -(a * q + p);
  const c = p * q;

  const statement = `Solve for \\(x\\): \\[${quadraticLatex(a, b, c)} = 0\\]`;
  const r1Latex = a === 1 ? `${p}` : fractionLatex(p, a);
  const r2Latex = `${q}`;
  const answerLatex = `x = ${r1Latex},\\ x = ${r2Latex}`;

  const steps = [
    {
      latex: `${quadraticLatex(a, b, c)} = 0`,
      note: "Start with the equation in standard form.",
    },
    {
      latex: `(${term(a, "x")}${signedTerm(-p)})(x${signedTerm(-q)}) = 0`,
      note: `Factor the quadratic${a > 1 ? " (look for a factor pair that works with the leading coefficient)" : ""}.`,
    },
    {
      latex: `${term(a, "x")}${signedTerm(-p)} = 0 \\quad \\text{or} \\quad x${signedTerm(-q)} = 0`,
      note: "Set each factor equal to zero (zero product property).",
    },
    {
      latex: `x = ${r1Latex} \\quad \\text{or} \\quad x = ${r2Latex}`,
      note: "Solve each linear equation. These are the two solutions.",
    },
  ];

  const base = {
    style: "drill" as const,
    difficulty,
    statement_latex: statement,
    hint: "Factor the quadratic, then use the zero product property.",
    explanation_steps: steps,
  };

  if (format === "mcq") {
    const mc = buildChoices(rng, `x = ${r1Latex},\\ ${r2Latex}`, [
      {
        latex: `x = ${a === 1 ? -p : fractionLatex(-p, a)},\\ ${-q}`,
        misconception: "Sign error: used the factor constants directly instead of negating them.",
      },
      {
        latex: `x = ${a === 1 ? `${q}` : fractionLatex(q, a)},\\ ${a === 1 ? `${p}` : `${q === p ? p + 1 : p}`}`,
        misconception: "Mixed up which root belongs to which factor after dividing by the leading coefficient.",
      },
      {
        latex: `x = ${b},\\ ${c}`,
        misconception: "Read the coefficients of the equation as its solutions.",
      },
    ]);
    return { ...base, format: "mcq", ...mc };
  }

  if (format === "ordering") {
    return {
      ...base,
      statement_latex: `These steps solve \\[${quadraticLatex(a, b, c)} = 0\\] Put them in the right order.`,
      format: "ordering",
      ...buildOrdering(rng, steps),
    };
  }

  return {
    ...base,
    format: "open",
    answer: multiValueAnswer(answerLatex, [`${r1Latex}, ${r2Latex}`, `${r2Latex}, ${r1Latex}`]),
  };
}

function irrationalRoots(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
  // x^2 + bx + c with positive non-square discriminant
  let b = 0;
  let c = 0;
  let D = 0;
  for (let tries = 0; tries < 50; tries++) {
    b = rng.nonZeroInt(-9, 9);
    c = rng.nonZeroInt(-12, 12);
    D = b * b - 4 * c;
    if (D > 0 && Math.sqrt(D) % 1 !== 0) break;
  }
  const { k, m } = simplifyRadical(D);
  // roots: (-b ± k√m) / 2
  const g = ((): number => {
    // simplify (−b ± k√m)/2 when both -b and k are even
    return b % 2 === 0 && k % 2 === 0 ? 2 : 1;
  })();
  const nb = -b / g;
  const nk = k / g;
  const nd = 2 / g;
  const radical = nk === 1 ? `\\sqrt{${m}}` : `${nk}\\sqrt{${m}}`;
  const core = nd === 1 ? `${nb} \\pm ${radical}` : `\\frac{${nb} \\pm ${radical}}{${nd}}`;
  const answerLatex = `x = ${core}`;

  const statement = `Solve for \\(x\\), giving your answer in simplified radical form: \\[${quadraticLatex(1, b, c)} = 0\\]`;

  const steps = [
    {
      latex: `x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}`,
      note: "The quadratic doesn't factor nicely, so use the quadratic formula.",
    },
    {
      latex: `x = \\frac{${-b} \\pm \\sqrt{${b * b} - 4(1)(${c})}}{2}`,
      note: `Substitute \\(a = 1\\), \\(b = ${b}\\), \\(c = ${c}\\).`,
    },
    {
      latex: `x = \\frac{${-b} \\pm \\sqrt{${D}}}{2}`,
      note: "Simplify under the radical (the discriminant).",
    },
    ...(k > 1
      ? [
          {
            latex: `\\sqrt{${D}} = \\sqrt{${k * k} \\cdot ${m}} = ${k}\\sqrt{${m}}`,
            note: `Pull the largest perfect square factor out of the radical.`,
          },
        ]
      : []),
    {
      latex: answerLatex,
      note: g === 2 ? "Divide every term by the common factor 2 to finish simplifying." : "This is the simplified exact answer.",
    },
  ];

  const base = {
    style: "drill" as const,
    difficulty,
    statement_latex: statement,
    hint: "Use the quadratic formula and simplify the radical.",
    explanation_steps: steps,
  };

  if (format === "mcq") {
    const wrongD = b * b + 4 * c;
    const mc = buildChoices(rng, core, [
      {
        latex: nd === 1 ? `${-nb} \\pm ${radical}` : `\\frac{${-nb} \\pm ${radical}}{${nd}}`,
        misconception: "Forgot to negate b in the quadratic formula.",
      },
      {
        latex: `\\frac{${-b} \\pm \\sqrt{${wrongD > 0 ? wrongD : D + 8}}}{2}`,
        misconception: "Added 4ac instead of subtracting it in the discriminant.",
      },
      {
        latex: `\\frac{${-b} \\pm \\sqrt{${D}}}{2}` === core ? `\\frac{${-b} \\pm \\sqrt{${D}}}{4}` : `\\frac{${-b} \\pm \\sqrt{${D}}}{2}`,
        misconception: k > 1 ? "Did not simplify the radical fully." : "Used 2a = 4 in the denominator.",
      },
    ]);
    return { ...base, format: "mcq", ...mc };
  }

  if (format === "ordering") {
    return {
      ...base,
      statement_latex: `These steps solve the equation using the quadratic formula. Put them in the right order.`,
      format: "ordering",
      ...buildOrdering(rng, steps),
    };
  }

  return {
    ...base,
    format: "open",
    answer: multiValueAnswer(answerLatex, [core]),
  };
}
