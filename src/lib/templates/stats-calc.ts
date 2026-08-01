import type { GeneratedProblem, ProblemFormat } from "@/lib/ai/schemas";
import type { Rng } from "@/lib/rng";
import type { Template } from "@/lib/templates/types";
import {
  buildChoices,
  expressionAnswer,
  fractionLatex,
  gcd,
  numericAnswer,
  numericDistractors,
  signedTerm,
  term,
} from "@/lib/templates/helpers";

/* ── Centre and spread ───────────────────────────────────────────── */

/**
 * Mean, median, mode and range over a small data set.
 *
 * The set is built to have a whole-number mean and, above difficulty 1, a mean
 * that differs from the median — otherwise the classic confusion between the
 * two can't show up in the distractors.
 */
export const centerSpread: Template = {
  id: "center-spread",
  topicSlugs: ["center-spread"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const n = difficulty === 1 ? 5 : rng.pick([5, 6, 7]);
    const values: number[] = [];
    for (let i = 0; i < n - 1; i++) values.push(rng.int(2, 40));
    // Choose the last value so the total divides evenly by n.
    const partial = values.reduce((s, v) => s + v, 0);
    const last = ((Math.ceil(partial / n) + rng.int(1, 3)) * n) - partial;
    values.push(last);

    const data = rng.shuffle(values);
    const sorted = [...data].sort((a, b) => a - b);
    const total = sorted.reduce((s, v) => s + v, 0);
    const mean = total / n;
    const median =
      n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const range = sorted[n - 1] - sorted[0];

    const measure =
      difficulty === 1 ? "mean" : difficulty === 2 ? "median" : rng.pick(["mean", "median", "range"]);
    const value = measure === "mean" ? mean : measure === "median" ? median : range;

    const listed = data.join(",\\ ");
    const sortedList = sorted.join(",\\ ");

    const steps =
      measure === "mean"
        ? [
            { latex: `\\bar{x} = \\frac{\\sum x}{n}`, note: "The mean is the total divided by how many values there are." },
            { latex: `\\sum x = ${total}`, note: "Add every value." },
            { latex: `\\bar{x} = \\frac{${total}}{${n}} = ${mean}`, note: `Divide by ${n}.` },
          ]
        : measure === "median"
          ? [
              { latex: sortedList, note: "Sort the values first — the median is a position, not a total." },
              {
                latex: `${median}`,
                note:
                  n % 2 === 1
                    ? `With ${n} values the median is the middle one.`
                    : `With ${n} values the median is the average of the two middle ones.`,
              },
            ]
          : [
              { latex: sortedList, note: "Sort to find the extremes." },
              { latex: `${sorted[n - 1]} - ${sorted[0]} = ${range}`, note: "Range is largest minus smallest." },
            ];

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: `For the data set \\[${listed}\\] find the ${measure}.`,
      hint:
        measure === "mean"
          ? "Add everything, then divide by how many values there are."
          : measure === "median"
            ? "Sort first — the median is the middle value once ordered."
            : "Sort first, then subtract the smallest from the largest.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(
        rng,
        `${value}`,
        numericDistractors(value, [
          {
            value: measure === "mean" ? median : mean,
            misconception:
              measure === "mean"
                ? "Gave the median instead of the mean."
                : "Gave the mean instead of the value asked for.",
          },
          {
            value: measure === "range" ? sorted[n - 1] : range,
            misconception:
              measure === "range"
                ? "Gave the largest value rather than the spread."
                : "Gave the range instead of a measure of centre.",
          },
          {
            value: data[Math.floor(n / 2)],
            misconception: "Took the middle of the unsorted list.",
          },
          { value: total, misconception: "Gave the total instead of a summary of it." },
          { value: sorted[0], misconception: "Gave the smallest value." },
        ])
      );
      return { ...base, format: "mcq", ...mc };
    }
    return { ...base, format: "open", answer: numericAnswer(value) };
  },
};

/* ── Probability ─────────────────────────────────────────────────── */

/**
 * Single events, then compound ones. The distractors carry the two errors this
 * topic lives on: adding probabilities that should be multiplied, and treating
 * draws without replacement as independent.
 */
export const simpleProbability: Template = {
  id: "simple-probability",
  topicSlugs: ["probability-rules"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const red = rng.int(2, 9);
    const blue = rng.int(2, 9);
    const green = rng.int(1, 6);
    const totalBalls = red + blue + green;

    let num: number;
    let den: number;
    let statement: string;
    let steps: { latex: string; note: string }[];
    let distractors: { latex: string; misconception: string }[];
    let hint: string;

    if (difficulty === 1) {
      num = red;
      den = totalBalls;
      statement = `A bag holds \\(${red}\\) red, \\(${blue}\\) blue and \\(${green}\\) green marbles. One is drawn at random. Find the probability that it is red.`;
      hint = "Favourable outcomes over total outcomes.";
      steps = [
        { latex: `P = \\frac{\\text{favourable}}{\\text{total}}`, note: "Every marble is equally likely." },
        { latex: `P = \\frac{${red}}{${totalBalls}}`, note: `There are ${totalBalls} marbles in all.` },
        { latex: fractionLatex(num, den), note: "Reduce." },
      ];
      distractors = [
        { latex: fractionLatex(red, blue + green), misconception: "Compared red to the other colours instead of to the total." },
        { latex: fractionLatex(blue, totalBalls), misconception: "Counted the wrong colour." },
        { latex: fractionLatex(totalBalls, red), misconception: "Inverted the fraction." },
      ];
    } else if (difficulty === 2) {
      num = red + blue;
      den = totalBalls;
      statement = `A bag holds \\(${red}\\) red, \\(${blue}\\) blue and \\(${green}\\) green marbles. One is drawn at random. Find the probability that it is red or blue.`;
      hint = "The events can't both happen, so the probabilities add.";
      steps = [
        { latex: `P(A \\cup B) = P(A) + P(B)`, note: "A marble can't be two colours, so the events are mutually exclusive." },
        { latex: `\\frac{${red}}{${totalBalls}} + \\frac{${blue}}{${totalBalls}}`, note: "Same denominator already." },
        { latex: fractionLatex(num, den), note: "Add the numerators and reduce." },
      ];
      distractors = [
        { latex: fractionLatex(red * blue, totalBalls * totalBalls), misconception: "Multiplied when the events are alternatives, not a sequence." },
        { latex: fractionLatex(green, totalBalls), misconception: "Found the probability of the complement." },
        { latex: fractionLatex(num, red + blue), misconception: "Used the favourable count as the total." },
      ];
    } else if (difficulty === 3) {
      num = red * red;
      den = totalBalls * totalBalls;
      statement = `A bag holds \\(${red}\\) red, \\(${blue}\\) blue and \\(${green}\\) green marbles. A marble is drawn, replaced, then another is drawn. Find the probability that both are red.`;
      hint = "With replacement the two draws are independent, so the probabilities multiply.";
      steps = [
        { latex: `P(A \\cap B) = P(A) \\times P(B)`, note: "The marble goes back, so the second draw is unaffected." },
        { latex: `\\frac{${red}}{${totalBalls}} \\times \\frac{${red}}{${totalBalls}}`, note: "The bag is identical both times." },
        { latex: fractionLatex(num, den), note: "Multiply and reduce." },
      ];
      distractors = [
        { latex: fractionLatex(2 * red, totalBalls), misconception: "Added the two probabilities instead of multiplying." },
        { latex: fractionLatex(red * (red - 1), totalBalls * (totalBalls - 1)), misconception: "Treated the draws as being without replacement." },
        { latex: fractionLatex(red, totalBalls), misconception: "Gave the probability of a single draw." },
      ];
    } else {
      num = red * (red - 1);
      den = totalBalls * (totalBalls - 1);
      statement = `A bag holds \\(${red}\\) red, \\(${blue}\\) blue and \\(${green}\\) green marbles. Two are drawn without replacement. Find the probability that both are red.`;
      hint = "After the first red is removed, both the reds and the total are one smaller.";
      steps = [
        { latex: `P(\\text{first red}) = \\frac{${red}}{${totalBalls}}`, note: "Start with the full bag." },
        { latex: `P(\\text{second red}) = \\frac{${red - 1}}{${totalBalls - 1}}`, note: "One red has gone, and so has one marble overall." },
        { latex: `\\frac{${red}}{${totalBalls}} \\times \\frac{${red - 1}}{${totalBalls - 1}}`, note: "Multiply the conditional probabilities." },
        { latex: fractionLatex(num, den), note: "Reduce." },
      ];
      distractors = [
        { latex: fractionLatex(red * red, totalBalls * totalBalls), misconception: "Forgot that the first marble is not replaced." },
        { latex: fractionLatex(2 * red, totalBalls), misconception: "Added the probabilities instead of multiplying." },
        { latex: fractionLatex(red - 1, totalBalls - 1), misconception: "Only accounted for the second draw." },
      ];
    }

    const answer = fractionLatex(num, den);
    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint,
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(rng, answer, distractors);
      return { ...base, format: "mcq", ...mc };
    }
    const g = gcd(num, den) || 1;
    return {
      ...base,
      format: "open",
      answer: {
        value_latex: answer,
        kind: "expression",
        numeric_value: num / den,
        tolerance: 1e-6,
        acceptable_forms: [`${num / g}/${den / g}`, (num / den).toFixed(4)],
        multi_valued: false,
      },
    };
  },
};

/* ── Antiderivatives ─────────────────────────────────────────────── */

/**
 * Power-rule integration. `+ C` is handled through `acceptable_forms` rather
 * than being required, since a student who omits it has made a notation slip
 * rather than an integration error — but the explanation always states it.
 */
export const antiderivatives: Template = {
  id: "antiderivatives",
  topicSlugs: ["antiderivatives"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const n = rng.int(2, 5);
    const a = rng.nonZeroInt(-8, 8);
    const b = rng.nonZeroInt(-9, 9);

    let answer: string;
    let statement: string;
    let steps: { latex: string; note: string }[];
    let distractors: { latex: string; misconception: string }[];

    if (difficulty <= 2) {
      // a x^n + b, chosen so the coefficient divides exactly.
      const coef = a * (n + 1);
      answer = `${term(a, `x^{${n + 1}}`)}${signedTerm(b, "x")} + C`;
      statement = `Find the general antiderivative: \\[\\int \\left(${term(coef, `x^{${n}}`)}${signedTerm(b)}\\right)\\, dx\\]`;
      steps = [
        { latex: `\\int x^n\\, dx = \\frac{x^{n+1}}{n+1} + C`, note: "The power rule for integration: raise the power, then divide by the new power." },
        { latex: `\\frac{${coef}}{${n + 1}}x^{${n + 1}}${signedTerm(b, "x")}`, note: "Apply it term by term." },
        { latex: answer, note: "Simplify, and never forget the constant of integration." },
      ];
      distractors = [
        { latex: `${term(coef, `x^{${n + 1}}`)}${signedTerm(b, "x")} + C`, misconception: "Raised the power but forgot to divide by the new exponent." },
        {
          // n >= 2, so the derivative's exponent is >= 1 — write x, not x^{1}.
          latex: `${term(coef * n, n === 2 ? "x" : `x^{${n - 1}}`)} + C`,
          misconception: "Differentiated instead of integrating.",
        },
        { latex: `${term(a, `x^{${n + 1}}`)}${signedTerm(b, "x")}`, misconception: "Omitted the constant of integration." },
      ];
    } else {
      // Definite integral of a x^n from 0 to upper.
      const upper = rng.int(1, 3);
      const coef = a * (n + 1);
      const value = a * Math.pow(upper, n + 1);
      answer = `${value}`;
      statement = `Evaluate: \\[\\int_0^{${upper}} ${term(coef, `x^{${n}}`)}\\, dx\\]`;
      steps = [
        { latex: `\\int ${coef}x^{${n}}\\, dx = ${term(a, `x^{${n + 1}}`)}`, note: "Find the antiderivative first." },
        { latex: `\\Big[${term(a, `x^{${n + 1}}`)}\\Big]_0^{${upper}}`, note: "The constant cancels in a definite integral." },
        { latex: `${a}(${upper})^{${n + 1}} - ${a}(0)^{${n + 1}}`, note: "Evaluate at the top limit, then subtract the bottom." },
        { latex: `${value}`, note: "Simplify." },
      ];
      // Numeric answer, so guard against two misconceptions landing on the
      // same number and shrinking the question.
      distractors = numericDistractors(value, [
        { value: coef * Math.pow(upper, n + 1), misconception: "Forgot to divide by the new exponent." },
        { value: coef * n * Math.pow(upper, n - 1), misconception: "Differentiated instead of integrating." },
        { value: -value, misconception: "Subtracted the limits the wrong way round." },
      ]);
    }

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint:
        difficulty <= 2
          ? "Raise each power by one, divide by the new power, and add C."
          : "Antidifferentiate first, then evaluate at the limits — top minus bottom.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(rng, answer, distractors);
      return { ...base, format: "mcq", ...mc };
    }
    return {
      ...base,
      format: "open",
      answer:
        difficulty <= 2
          ? expressionAnswer(answer, [
              answer.replace(" + C", ""),
              answer.replace(" + C", "+C"),
            ])
          : numericAnswer(Number(answer)),
    };
  },
};
