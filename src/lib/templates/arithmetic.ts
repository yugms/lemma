import type { GeneratedProblem, ProblemFormat } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";
import type { Template } from "@/lib/templates/types";
import {
  buildChoices,
  fractionLatex,
  gcd,
  numericAnswer,
  numericDistractors,
  signedTerm,
} from "@/lib/templates/helpers";

/**
 * Foundations arithmetic. Three templates that share a file because they share
 * a shape: pick clean operands, compute exactly, and build distractors out of
 * the specific slip each operation invites.
 *
 * Every distractor here is a real error a student makes — sign dropped on
 * subtraction of a negative, denominators added, left-to-right evaluation
 * ignoring precedence — not a nearby number.
 */

/* ── Integer operations ──────────────────────────────────────────── */

export const integerOperations: Template = {
  id: "integer-operations",
  topicSlugs: ["integer-operations"],
  formats: ["open", "mcq"],
  difficulties: [1, 3],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const range = difficulty === 1 ? 9 : difficulty === 2 ? 15 : 25;
    const a = rng.nonZeroInt(-range, range);
    const b = rng.nonZeroInt(-range, range);
    const op = difficulty === 1 ? rng.pick(["+", "-"]) : rng.pick(["+", "-", "\\times"]);

    let value: number;
    let statement: string;
    let steps: { latex: string; note: string }[];

    if (op === "\\times") {
      value = a * b;
      statement = `Evaluate: \\[(${a}) \\times (${b})\\]`;
      steps = [
        {
          latex: `(${a}) \\times (${b})`,
          note: "Multiply the sizes, then decide the sign.",
        },
        {
          latex: `${Math.abs(a)} \\times ${Math.abs(b)} = ${Math.abs(value)}`,
          note: "Multiply without the signs first.",
        },
        {
          latex: `${value}`,
          note:
            a * b > 0
              ? "The signs match, so the product is positive."
              : "The signs differ, so the product is negative.",
        },
      ];
    } else if (op === "-") {
      value = a - b;
      statement = `Evaluate: \\[(${a}) - (${b})\\]`;
      steps = [
        { latex: `(${a}) - (${b})`, note: "Subtracting is adding the opposite." },
        { latex: `${a}${signedTerm(-b)}`, note: `Rewrite as ${a} plus ${-b}.` },
        { latex: `${value}`, note: "Add." },
      ];
    } else {
      value = a + b;
      statement = `Evaluate: \\[(${a}) + (${b})\\]`;
      steps = [
        { latex: `(${a}) + (${b})`, note: "Start with the sum." },
        {
          latex: `${value}`,
          note:
            a * b > 0
              ? "Same signs: add the sizes and keep the sign."
              : "Different signs: subtract the smaller size from the larger and keep the sign of the larger.",
        },
      ];
    }

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint:
        op === "\\times"
          ? "Multiply the sizes first, then work out the sign."
          : "Rewrite subtraction as adding the opposite, then compare sizes.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(
        rng,
        `${value}`,
        numericDistractors(value, [
          { value: -value, misconception: "Correct size, wrong sign." },
          {
            value: op === "-" ? a + b : a - b,
            misconception:
              op === "-"
                ? "Added instead of subtracting — the double negative was missed."
                : "Subtracted instead of adding.",
          },
          {
            value: Math.abs(a) + Math.abs(b),
            misconception: "Ignored the signs and just added the sizes.",
          },
          {
            value: Math.abs(a) - Math.abs(b),
            misconception: "Worked with sizes only and kept the wrong sign.",
          },
        ])
      );
      return { ...base, format: "mcq", ...mc };
    }
    return { ...base, format: "open", answer: numericAnswer(value) };
  },
};

/* ── Order of operations ─────────────────────────────────────────── */

export const orderOfOperations: Template = {
  id: "order-of-operations",
  topicSlugs: ["order-of-operations"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const a = rng.int(2, 9);
    const b = rng.int(2, 9);
    const c = rng.int(2, 9);
    const d = rng.int(2, 6);

    let value: number;
    let leftToRight: number;
    let statement: string;
    let steps: { latex: string; note: string }[];

    if (difficulty === 1) {
      // a + b * c — the classic precedence trap.
      value = a + b * c;
      leftToRight = (a + b) * c;
      statement = `Evaluate: \\[${a} + ${b} \\times ${c}\\]`;
      steps = [
        { latex: `${a} + ${b} \\times ${c}`, note: "Multiplication comes before addition." },
        { latex: `${a} + ${b * c}`, note: `Multiply ${b} by ${c} first.` },
        { latex: `${value}`, note: "Then add." },
      ];
    } else if (difficulty === 2) {
      // (a + b) * c - d
      value = (a + b) * c - d;
      leftToRight = a + b * c - d;
      statement = `Evaluate: \\[(${a} + ${b}) \\times ${c} - ${d}\\]`;
      steps = [
        { latex: `(${a} + ${b}) \\times ${c} - ${d}`, note: "Brackets first." },
        { latex: `${a + b} \\times ${c} - ${d}`, note: `Add inside the brackets.` },
        { latex: `${(a + b) * c} - ${d}`, note: "Then multiply." },
        { latex: `${value}`, note: "Then subtract." },
      ];
    } else if (difficulty === 3) {
      // a + b * c^2
      value = a + b * c * c;
      leftToRight = (a + b) * c * c;
      statement = `Evaluate: \\[${a} + ${b} \\times ${c}^2\\]`;
      steps = [
        { latex: `${a} + ${b} \\times ${c}^2`, note: "Exponents come before multiplication." },
        { latex: `${a} + ${b} \\times ${c * c}`, note: `Square the ${c}.` },
        { latex: `${a} + ${b * c * c}`, note: "Then multiply." },
        { latex: `${value}`, note: "Then add." },
      ];
    } else {
      // (a + b)^2 - c * d
      value = (a + b) * (a + b) - c * d;
      leftToRight = a + b * b - c * d;
      statement = `Evaluate: \\[(${a} + ${b})^2 - ${c} \\times ${d}\\]`;
      steps = [
        { latex: `(${a} + ${b})^2 - ${c} \\times ${d}`, note: "Brackets first, then the exponent." },
        { latex: `${a + b}^2 - ${c} \\times ${d}`, note: "Add inside the brackets." },
        { latex: `${(a + b) * (a + b)} - ${c} \\times ${d}`, note: "Square it." },
        { latex: `${(a + b) * (a + b)} - ${c * d}`, note: "Multiply." },
        { latex: `${value}`, note: "Then subtract." },
      ];
    }

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint: "Brackets, then exponents, then multiply and divide, then add and subtract.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(
        rng,
        `${value}`,
        numericDistractors(value, [
          {
            value: leftToRight,
            misconception: "Worked strictly left to right instead of applying precedence.",
          },
          { value: value + d, misconception: "Dropped the final term." },
          { value: value - c, misconception: "Applied one operation twice." },
        ])
      );
      return { ...base, format: "mcq", ...mc };
    }
    return { ...base, format: "open", answer: numericAnswer(value) };
  },
};

/* ── Fraction arithmetic ─────────────────────────────────────────── */

export const fractionArithmetic: Template = {
  id: "fraction-arithmetic",
  topicSlugs: ["fraction-arithmetic"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const n1 = rng.int(1, 9);
    const d1 = rng.int(2, 9);
    const n2 = rng.int(1, 9);
    let d2 = rng.int(2, 9);
    // At the easiest level, keep denominators different so the exercise is
    // finding a common one — the whole point of the topic.
    while (difficulty === 1 && d2 === d1) d2 = rng.int(2, 9);

    const op = difficulty <= 2 ? rng.pick(["+", "-"]) : rng.pick(["+", "-", "\\times", "\\div"]);

    let num: number;
    let den: number;
    let steps: { latex: string; note: string }[];

    if (op === "\\times") {
      num = n1 * n2;
      den = d1 * d2;
      steps = [
        { latex: `\\frac{${n1}}{${d1}} \\times \\frac{${n2}}{${d2}}`, note: "Multiply straight across." },
        { latex: `\\frac{${num}}{${den}}`, note: "Numerators together, denominators together." },
        { latex: fractionLatex(num, den), note: "Reduce to lowest terms." },
      ];
    } else if (op === "\\div") {
      num = n1 * d2;
      den = d1 * n2;
      steps = [
        { latex: `\\frac{${n1}}{${d1}} \\div \\frac{${n2}}{${d2}}`, note: "Dividing is multiplying by the reciprocal." },
        { latex: `\\frac{${n1}}{${d1}} \\times \\frac{${d2}}{${n2}}`, note: "Flip the second fraction." },
        { latex: fractionLatex(num, den), note: "Multiply across and reduce." },
      ];
    } else {
      const lcd = (d1 * d2) / gcd(d1, d2);
      const a = n1 * (lcd / d1);
      const b = n2 * (lcd / d2);
      num = op === "+" ? a + b : a - b;
      den = lcd;
      steps = [
        {
          latex: `\\frac{${n1}}{${d1}} ${op} \\frac{${n2}}{${d2}}`,
          note: `A common denominator is needed before ${op === "+" ? "adding" : "subtracting"}.`,
        },
        {
          latex: `\\frac{${a}}{${lcd}} ${op} \\frac{${b}}{${lcd}}`,
          note: `Rewrite both over ${lcd}.`,
        },
        { latex: `\\frac{${num}}{${lcd}}`, note: `${op === "+" ? "Add" : "Subtract"} the numerators only.` },
        { latex: fractionLatex(num, den), note: "Reduce to lowest terms." },
      ];
    }

    const answer = fractionLatex(num, den);
    const opName = op === "\\times" ? "\\times" : op === "\\div" ? "\\div" : op;

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: `Evaluate, giving your answer in lowest terms: \\[\\frac{${n1}}{${d1}} ${opName} \\frac{${n2}}{${d2}}\\]`,
      hint:
        op === "+" || op === "-"
          ? "Rewrite both fractions over a common denominator first — the denominators are not added."
          : op === "\\div"
            ? "Turn the division into multiplication by the reciprocal."
            : "Multiply numerators together and denominators together, then reduce.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const acrossNum = op === "+" ? n1 + n2 : op === "-" ? n1 - n2 : num;
      const acrossDen = op === "+" || op === "-" ? d1 + d2 : den;
      const mc = buildChoices(rng, answer, [
        {
          latex: fractionLatex(acrossNum, acrossDen),
          misconception:
            op === "+" || op === "-"
              ? "Added the denominators as well as the numerators."
              : "Combined the fractions without reducing correctly.",
        },
        { latex: fractionLatex(den, num), misconception: "Inverted the final fraction." },
        {
          latex: fractionLatex(num + 1, den),
          misconception: "Arithmetic slip in the numerator.",
        },
      ]);
      return { ...base, format: "mcq", ...mc };
    }
    return {
      ...base,
      format: "open",
      answer: {
        value_latex: answer,
        kind: "expression",
        numeric_value: den === 0 ? null : num / den,
        tolerance: null,
        acceptable_forms: [`${num}/${den}`, fractionLatex(num, den)],
        multi_valued: false,
      },
    };
  },
};

/* ── Percent and percent change ──────────────────────────────────── */

export const percentChange: Template = {
  id: "percent-change",
  topicSlugs: ["percent-change", "ratio-proportion"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    // Percentages that divide cleanly, so answers stay exact at every level.
    const pct = rng.pick(difficulty === 1 ? [10, 20, 25, 50] : [5, 12, 15, 20, 24, 30, 40, 75]);
    const base100 = rng.int(2, 40) * 25;

    let value: number;
    let statement: string;
    let steps: { latex: string; note: string }[];
    let hint: string;

    if (difficulty <= 2) {
      value = (base100 * pct) / 100;
      statement = `What is \\(${pct}\\%\\) of \\(${base100}\\)?`;
      hint = "A percent is a fraction out of 100 — multiply.";
      steps = [
        { latex: `${pct}\\% \\times ${base100}`, note: "Write the percent as a decimal or fraction." },
        { latex: `\\frac{${pct}}{100} \\times ${base100}`, note: `${pct}% means ${pct} per hundred.` },
        { latex: `${value}`, note: "Multiply." },
      ];
    } else if (difficulty === 3) {
      value = base100 + (base100 * pct) / 100;
      statement = `A price of \\(\\$${base100}\\) increases by \\(${pct}\\%\\). What is the new price?`;
      hint = "Find the increase, then add it on — or multiply by (100% + the increase).";
      steps = [
        { latex: `\\frac{${pct}}{100} \\times ${base100} = ${(base100 * pct) / 100}`, note: "Work out the increase." },
        { latex: `${base100} + ${(base100 * pct) / 100}`, note: "Add it to the original price." },
        { latex: `${value}`, note: `Or in one step: ${base100} \\times ${1 + pct / 100}.` },
      ];
    } else {
      value = base100 - (base100 * pct) / 100;
      statement = `A jacket costs \\(\\$${base100}\\). In a sale it is reduced by \\(${pct}\\%\\). What is the sale price?`;
      hint = "The sale price is (100 − the discount) percent of the original.";
      steps = [
        { latex: `\\frac{${pct}}{100} \\times ${base100} = ${(base100 * pct) / 100}`, note: "Work out the discount." },
        { latex: `${base100} - ${(base100 * pct) / 100}`, note: "Subtract it from the original price." },
        { latex: `${value}`, note: `Or in one step: ${base100} \\times ${(100 - pct) / 100}.` },
      ];
    }

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint,
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const part = (base100 * pct) / 100;
      const mc = buildChoices(
        rng,
        `${value}`,
        numericDistractors(value, [
          {
            value: difficulty <= 2 ? base100 - part : part,
            misconception:
              difficulty <= 2
                ? "Subtracted the percentage instead of finding it."
                : "Gave the change itself rather than the resulting amount.",
          },
          {
            value: difficulty === 4 ? base100 + part : base100 - part,
            misconception: "Applied the change in the wrong direction.",
          },
          { value: base100 * pct, misconception: "Forgot to divide by 100." },
          { value: base100, misconception: "Gave the original amount unchanged." },
        ])
      );
      return { ...base, format: "mcq", ...mc };
    }
    return { ...base, format: "open", answer: numericAnswer(value) };
  },
};
