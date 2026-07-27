import type { GeneratedProblem } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";
import type { Template } from "@/lib/templates/types";
import { buildChoices, expressionAnswer, signedTerm, term } from "@/lib/templates/helpers";

/**
 * Derivative rules.
 * d1: polynomial power rule
 * d2: negative powers / roots rewritten as powers
 * d3: chain rule on (ax+b)^n
 * d4-5: chain rule with trig or exponential outer functions
 */
export const derivativeRules: Template = {
  id: "derivative-rules",
  topicSlugs: ["derivative-rules"],
  formats: ["open", "mcq"],
  difficulties: [1, 5],
  generate(rng: Rng, difficulty: number, format): GeneratedProblem {
    if (difficulty <= 2) return powerRule(rng, difficulty, format);
    return chainRule(rng, difficulty, format);
  },
};

function powerRule(rng: Rng, difficulty: number, format: "mcq" | "open" | "fill_blank"): GeneratedProblem {
  const a = rng.nonZeroInt(-6, 6);
  const n = rng.int(3, 5);
  const b = rng.nonZeroInt(-8, 8);
  const m = difficulty === 1 ? 2 : rng.pick([2, -1, -2]);
  const c = rng.nonZeroInt(-9, 9);

  const mTerm = m > 0 ? term(b, `x^{${m}}`) : `${term(b, "")}x^{${m}}`;
  const f = `${term(a, `x^{${n}}`)}${m > 0 ? signedTerm(b, m === 1 ? "x" : `x^{${m}}`) : ` ${b >= 0 ? "+" : "-"} ${Math.abs(b)}x^{${m}}`}${signedTerm(c, "x")}`;
  const statement = `Find \\(f'(x)\\) for \\[f(x) = ${f}\\]`;

  const d1 = a * n;
  const d2 = b * m;
  const dLatex = `${term(d1, `x^{${n - 1}}`)}${m - 1 === 0 ? signedTerm(d2) : m - 1 === 1 ? signedTerm(d2, "x") : ` ${d2 >= 0 ? "+" : "-"} ${Math.abs(d2)}x^{${m - 1}}`}${signedTerm(c)}`;

  const steps = [
    {
      latex: `\\frac{d}{dx}\\left[x^{k}\\right] = kx^{k-1}`,
      note: "Apply the power rule to each term: multiply by the exponent, then reduce the exponent by 1.",
    },
    {
      latex: `\\frac{d}{dx}\\left[${term(a, `x^{${n}}`)}\\right] = ${term(d1, `x^{${n - 1}}`)}`,
      note: `First term: \\(${a} \\cdot ${n} = ${d1}\\).`,
    },
    {
      latex: `\\frac{d}{dx}\\left[${m === 2 ? term(b, `x^{2}`) : `${b}x^{${m}}`}\\right] = ${m - 1 === 1 ? term(d2, "x") : `${d2}x^{${m - 1}}`}`,
      note: `Second term: \\(${b} \\cdot ${m} = ${d2}\\); the exponent drops to ${m - 1}. ${m < 0 ? "Negative exponents follow the same rule." : ""}`,
    },
    {
      latex: `f'(x) = ${dLatex}`,
      note: `The linear term differentiates to the constant ${c}. Combine all terms.`,
    },
  ];

  const base = {
    style: "drill" as const,
    difficulty,
    statement_latex: statement,
    hint: "Differentiate term by term with the power rule.",
    explanation_steps: steps,
  };

  if (format === "mcq") {
    const wrong1 = `${term(a, `x^{${n - 1}}`)}${m - 1 === 1 ? signedTerm(b, "x") : ` ${b >= 0 ? "+" : "-"} ${Math.abs(b)}x^{${m - 1}}`}${signedTerm(c)}`;
    const wrong2 = `${term(d1, `x^{${n}}`)}${` ${d2 >= 0 ? "+" : "-"} ${Math.abs(d2)}x^{${m}}`}${signedTerm(c, "x")}`;
    const wrong3 = `${term(d1, `x^{${n - 1}}`)}${m - 1 === 1 ? signedTerm(d2, "x") : ` ${d2 >= 0 ? "+" : "-"} ${Math.abs(d2)}x^{${m - 1}}`}`;
    const mc = buildChoices(rng, dLatex, [
      { latex: wrong1, misconception: "Reduced the exponents but forgot to multiply by them." },
      { latex: wrong2, misconception: "Multiplied by the exponents but forgot to reduce them." },
      { latex: wrong3, misconception: "Dropped the derivative of the linear term (it becomes a constant, not zero)." },
    ]);
    return { ...base, format: "mcq", ...mc };
  }

  return { ...base, format: "open", answer: expressionAnswer(dLatex) };
}

function chainRule(rng: Rng, difficulty: number, format: "mcq" | "open" | "fill_blank"): GeneratedProblem {
  const a = rng.nonZeroInt(2, 5);
  const b = rng.nonZeroInt(-7, 7);
  const inner = `${a}x${signedTerm(b)}`;

  type Variant = { f: string; d: string; wrongNoChain: string; wrongInner: string; hint: string; outerNote: string };
  const n = rng.int(3, 6);
  const variants: Variant[] = [
    {
      f: `(${inner})^{${n}}`,
      d: `${n * a}(${inner})^{${n - 1}}`,
      wrongNoChain: `${n}(${inner})^{${n - 1}}`,
      wrongInner: `${n}(${a})^{${n - 1}}`,
      hint: "Differentiate the outer power first, then multiply by the derivative of the inside.",
      outerNote: `Power rule on the outside: bring down the ${n}, reduce the exponent.`,
    },
    ...(difficulty >= 4
      ? [
          {
            f: `\\sin(${inner})`,
            d: `${a}\\cos(${inner})`,
            wrongNoChain: `\\cos(${inner})`,
            wrongInner: `-${a}\\cos(${inner})`,
            hint: "The derivative of sine is cosine — then apply the chain rule.",
            outerNote: "The outer function is sine; its derivative is cosine of the same inside.",
          },
          {
            f: `e^{${inner}}`,
            d: `${a}e^{${inner}}`,
            wrongNoChain: `e^{${inner}}`,
            wrongInner: `e^{${a}}`,
            hint: "The exponential is its own derivative — times the derivative of the exponent.",
            outerNote: "The outer function is the exponential; it reproduces itself.",
          },
        ]
      : []),
  ];
  const v = rng.pick(variants);

  const statement = `Find \\(\\dfrac{dy}{dx}\\) for \\[y = ${v.f}\\]`;
  const steps = [
    {
      latex: `\\frac{dy}{dx} = f'(g(x)) \\cdot g'(x)`,
      note: "This is a composition, so use the chain rule: derivative of the outside evaluated at the inside, times the derivative of the inside.",
    },
    { latex: `g(x) = ${inner}, \\quad g'(x) = ${a}`, note: "Identify the inner function and differentiate it." },
    { latex: `\\frac{dy}{dx} = ${v.d}`, note: `${v.outerNote} Multiply by \\(g'(x) = ${a}\\).` },
  ];

  const base = {
    style: "drill" as const,
    difficulty,
    statement_latex: statement,
    hint: v.hint,
    explanation_steps: steps,
  };

  if (format === "mcq") {
    const mc = buildChoices(rng, v.d, [
      { latex: v.wrongNoChain, misconception: "Forgot to multiply by the derivative of the inner function (chain rule)." },
      { latex: v.wrongInner, misconception: "Mishandled the inner function when applying the chain rule." },
      { latex: `${v.d} + ${a}`, misconception: "Added the inner derivative instead of multiplying by it." },
    ]);
    return { ...base, format: "mcq", ...mc };
  }

  return { ...base, format: "open", answer: expressionAnswer(v.d) };
}
