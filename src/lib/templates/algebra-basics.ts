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

/* ── Exponent rules ──────────────────────────────────────────────── */

/**
 * The four laws, one per difficulty band. Distractors are built from the two
 * errors this topic actually produces: multiplying the exponents when they
 * should be added, and mishandling a negative exponent's sign.
 */
export const exponentRules: Template = {
  id: "exponent-rules",
  topicSlugs: ["exponent-rules"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const c1 = rng.int(2, 6);
    const c2 = rng.int(2, 6);
    const m = rng.int(2, 6);
    const n = rng.int(2, 5);

    let answer: string;
    let statement: string;
    let steps: { latex: string; note: string }[];
    let wrongExp: string;
    let hint: string;

    if (difficulty === 1) {
      answer = `${c1 * c2}x^{${m + n}}`;
      statement = `Simplify: \\[${term(c1, `x^{${m}}`)} \\cdot ${term(c2, `x^{${n}}`)}\\]`;
      hint = "Multiply the coefficients; the exponents of a common base add.";
      wrongExp = `${c1 * c2}x^{${m * n}}`;
      steps = [
        { latex: `${c1}x^{${m}} \\cdot ${c2}x^{${n}}`, note: "Group the numbers and the powers." },
        { latex: `(${c1} \\cdot ${c2})(x^{${m}} \\cdot x^{${n}})`, note: "Coefficients multiply." },
        { latex: answer, note: `Same base, so the exponents add: ${m} + ${n} = ${m + n}.` },
      ];
    } else if (difficulty === 2) {
      const bigger = m + n + 2;
      answer = `${fractionLatex(c1 * c2, 1)}x^{${bigger - n}}`;
      answer = `${c1 * c2}x^{${bigger - n}}`;
      statement = `Simplify: \\[\\frac{${term(c1 * c2, `x^{${bigger}}`)}}{${term(1, `x^{${n}}`)}}\\]`;
      hint = "Dividing powers of the same base subtracts the exponents.";
      wrongExp = `${c1 * c2}x^{${bigger / n > 1 ? Math.round(bigger / n) : 1}}`;
      steps = [
        { latex: `\\frac{${c1 * c2}x^{${bigger}}}{x^{${n}}}`, note: "Same base on top and bottom." },
        { latex: `${c1 * c2}x^{${bigger} - ${n}}`, note: "Subtract the exponents." },
        { latex: answer, note: "Simplify the exponent." },
      ];
    } else if (difficulty === 3) {
      answer = `${Math.pow(c1, n)}x^{${m * n}}`;
      statement = `Simplify: \\[\\left(${term(c1, `x^{${m}}`)}\\right)^{${n}}\\]`;
      hint = "A power of a power multiplies the exponents — and the coefficient is raised too.";
      wrongExp = `${c1 * n}x^{${m * n}}`;
      steps = [
        { latex: `\\left(${c1}x^{${m}}\\right)^{${n}}`, note: "The outer power applies to everything inside." },
        { latex: `${c1}^{${n}} \\cdot x^{${m} \\cdot ${n}}`, note: "Raise the coefficient and multiply the exponents." },
        { latex: answer, note: `${c1}^{${n}} = ${Math.pow(c1, n)}.` },
      ];
    } else {
      answer = `\\frac{${c1}}{x^{${m + n}}}`;
      statement = `Write with a positive exponent: \\[${term(c1, `x^{-${m + n}}`)}\\]`;
      hint = "A negative exponent moves the power to the other side of the fraction bar — the coefficient stays put.";
      wrongExp = `-\\frac{${c1}}{x^{${m + n}}}`;
      steps = [
        { latex: `${c1}x^{-${m + n}}`, note: "The negative exponent applies only to x." },
        { latex: `${c1} \\cdot \\frac{1}{x^{${m + n}}}`, note: "Move the power into the denominator." },
        { latex: answer, note: "The coefficient is not affected by the sign of the exponent." },
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
      const mc = buildChoices(rng, answer, [
        {
          latex: wrongExp,
          misconception:
            difficulty === 1
              ? "Multiplied the exponents instead of adding them."
              : difficulty === 2
                ? "Divided the exponents instead of subtracting them."
                : difficulty === 3
                  ? "Multiplied the coefficient by the power instead of raising it."
                  : "Made the whole expression negative rather than moving the power.",
        },
        { latex: `${c1 * c2}x^{${m}}`, misconception: "Kept only one of the exponents." },
        { latex: `${c1 + c2}x^{${m + n}}`, misconception: "Added the coefficients instead of multiplying." },
        // A fourth candidate so dedup against the answer can't leave a
        // three-option question next to the four-option ones.
        { latex: `${c1 * c2}x^{${n}}`, misconception: "Kept the wrong exponent." },
      ]);
      return { ...base, format: "mcq", ...mc };
    }
    return { ...base, format: "open", answer: expressionAnswer(answer) };
  },
};

/* ── Slope and lines ─────────────────────────────────────────────── */

/**
 * Slope from two points, then the line through them. Points are chosen so the
 * slope is a clean fraction and the intercept is an integer — at this level the
 * skill being tested is the method, not the arithmetic.
 */
export const slopeIntercept: Template = {
  id: "slope-intercept",
  topicSlugs: ["slope-intercept", "graphing-lines"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const run = rng.pick(difficulty <= 2 ? [1, 2] : [2, 3, 4]);
    const rise = rng.nonZeroInt(-9, 9);
    const b = rng.nonZeroInt(-9, 9);

    // Anchor x on a multiple of the run, so rise/run lands both points on
    // integer coordinates — otherwise the statement reads "(-5, 2.66666...)".
    const k = rng.int(-3, 2);
    const x1 = k * run;
    const x2 = x1 + run;
    const y1 = rise * k + b;
    const y2 = rise * (k + 1) + b;
    const slopeLatex = fractionLatex(rise, run);

    const cleanLine =
      run !== 0 && rise % run === 0
        ? `y = ${term(rise / run, "x")}${signedTerm(b)}`
        : `y = ${slopeLatex}x${signedTerm(b)}`;

    const steps = [
      {
        latex: `m = \\frac{y_2 - y_1}{x_2 - x_1}`,
        note: "Slope is the change in y over the change in x.",
      },
      {
        latex: `m = \\frac{${y2} - (${y1})}{${x2} - (${x1})} = \\frac{${y2 - y1}}{${x2 - x1}}`,
        note: "Substitute both points, keeping the order consistent.",
      },
      { latex: `m = ${slopeLatex}`, note: "Reduce." },
    ];

    if (difficulty >= 3) {
      steps.push(
        {
          latex: `${y1} = ${slopeLatex}(${x1}) + b`,
          note: "Put one point into y = mx + b to find the intercept.",
        },
        { latex: `b = ${b}`, note: "Solve for b." },
        { latex: cleanLine, note: "Write the equation." }
      );
    }

    const wantLine = difficulty >= 3;
    const answer = wantLine ? cleanLine : slopeLatex;

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: wantLine
        ? `Write the equation of the line through \\((${x1}, ${y1})\\) and \\((${x2}, ${y2})\\) in slope-intercept form.`
        : `Find the slope of the line through \\((${x1}, ${y1})\\) and \\((${x2}, ${y2})\\).`,
      hint: wantLine
        ? "Find the slope first, then substitute one point to get the intercept."
        : "Rise over run — subtract the y-values and the x-values in the same order.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const inverted = fractionLatex(run, rise);
      const mc = buildChoices(
        rng,
        answer,
        wantLine
          ? [
              {
                latex: `y = ${slopeLatex}x${signedTerm(-b)}`,
                misconception: "Sign error when solving for the intercept.",
              },
              {
                latex: `y = ${inverted}x${signedTerm(b)}`,
                misconception: "Used run over rise instead of rise over run.",
              },
              {
                latex: `y = ${slopeLatex}x${signedTerm(y1)}`,
                misconception: "Used a y-coordinate as the intercept without solving.",
              },
            ]
          : [
              { latex: inverted, misconception: "Computed run over rise instead of rise over run." },
              {
                latex: fractionLatex(-rise, run),
                misconception: "Subtracted the coordinates in opposite orders.",
              },
              {
                latex: fractionLatex(y2 + y1, x2 + x1),
                misconception: "Added the coordinates instead of subtracting.",
              },
            ]
      );
      return { ...base, format: "mcq", ...mc };
    }
    return {
      ...base,
      format: "open",
      answer: wantLine
        ? expressionAnswer(cleanLine, [cleanLine.replace("y = ", "")])
        : expressionAnswer(slopeLatex, [`${rise}/${run}`, String(rise / run)]),
    };
  },
};

/* ── Distance and midpoint ───────────────────────────────────────── */

export const distanceMidpoint: Template = {
  id: "distance-midpoint",
  topicSlugs: ["distance-midpoint"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const x1 = rng.int(-8, 8);
    const y1 = rng.int(-8, 8);
    // Even offsets keep the midpoint on integer coordinates.
    const dx = rng.nonZeroInt(-5, 5) * 2;
    const dy = rng.nonZeroInt(-5, 5) * 2;
    const x2 = x1 + dx;
    const y2 = y1 + dy;

    const wantMidpoint = difficulty <= 2;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;

    const d2 = dx * dx + dy * dy;
    const root = Math.sqrt(d2);
    const exact = Number.isInteger(root) ? `${root}` : `\\sqrt{${d2}}`;

    const statement = wantMidpoint
      ? `Find the midpoint of the segment joining \\((${x1}, ${y1})\\) and \\((${x2}, ${y2})\\).`
      : `Find the exact distance between \\((${x1}, ${y1})\\) and \\((${x2}, ${y2})\\).`;

    const steps = wantMidpoint
      ? [
          { latex: `M = \\left(\\frac{x_1 + x_2}{2}, \\frac{y_1 + y_2}{2}\\right)`, note: "The midpoint averages each coordinate." },
          { latex: `M = \\left(\\frac{${x1} + ${x2}}{2}, \\frac{${y1} + ${y2}}{2}\\right)`, note: "Substitute both points." },
          { latex: `M = (${mx}, ${my})`, note: "Simplify." },
        ]
      : [
          { latex: `d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}`, note: "The distance formula is the Pythagorean theorem on the plane." },
          { latex: `d = \\sqrt{(${dx})^2 + (${dy})^2}`, note: "Find each change." },
          { latex: `d = \\sqrt{${dx * dx} + ${dy * dy}} = \\sqrt{${d2}}`, note: "Square and add — both squares are positive." },
          { latex: `d = ${exact}`, note: "Simplify the radical." },
        ];

    const answer = wantMidpoint ? `(${mx}, ${my})` : exact;

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint: wantMidpoint
        ? "Average the x-coordinates, then average the y-coordinates."
        : "Square the horizontal and vertical changes, add, then take the root.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(
        rng,
        answer,
        wantMidpoint
          ? [
              { latex: `(${(x2 - x1) / 2}, ${(y2 - y1) / 2})`, misconception: "Subtracted the coordinates instead of averaging them." },
              { latex: `(${x1 + x2}, ${y1 + y2})`, misconception: "Added the coordinates but forgot to halve." },
              { latex: `(${my}, ${mx})`, misconception: "Swapped the coordinates." },
            ]
          : [
              { latex: `${Math.abs(dx) + Math.abs(dy)}`, misconception: "Added the changes instead of using the Pythagorean theorem." },
              { latex: `\\sqrt{${Math.abs(dx * dx - dy * dy)}}`, misconception: "Subtracted the squares instead of adding them." },
              { latex: `${d2}`, misconception: "Forgot to take the square root." },
            ]
      );
      return { ...base, format: "mcq", ...mc };
    }
    return {
      ...base,
      format: "open",
      answer: wantMidpoint
        ? expressionAnswer(answer, [`${mx}, ${my}`])
        : Number.isInteger(root)
          ? numericAnswer(root, exact)
          : expressionAnswer(exact, [`sqrt(${d2})`, root.toFixed(3)]),
    };
  },
};

/* ── Right triangles ─────────────────────────────────────────────── */

const TRIPLES: [number, number, number][] = [
  [3, 4, 5],
  [5, 12, 13],
  [8, 15, 17],
  [7, 24, 25],
  [9, 40, 41],
  [20, 21, 29],
];

/**
 * Pythagoras and the two special triangles. Difficulty 1-2 uses scaled triples
 * so every side is an integer; 3-4 moves to the 45-45-90 and 30-60-90 ratios,
 * where the answer is a surd and the common error is putting the radical on the
 * wrong side.
 */
export const pythagorean: Template = {
  id: "pythagorean",
  topicSlugs: ["pythagorean", "special-right-triangles"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    if (difficulty <= 2) {
      const [a0, b0, c0] = rng.pick(TRIPLES);
      const k = difficulty === 1 ? 1 : rng.int(1, 3);
      const [a, b, c] = [a0 * k, b0 * k, c0 * k];
      const findHypotenuse = rng.next() < 0.5;

      const answer = findHypotenuse ? `${c}` : `${b}`;
      const statement = findHypotenuse
        ? `A right triangle has legs of length \\(${a}\\) and \\(${b}\\). Find the hypotenuse.`
        : `A right triangle has a leg of length \\(${a}\\) and hypotenuse \\(${c}\\). Find the other leg.`;

      const steps = findHypotenuse
        ? [
            { latex: `a^2 + b^2 = c^2`, note: "The Pythagorean theorem." },
            { latex: `${a}^2 + ${b}^2 = c^2`, note: "Substitute the legs." },
            { latex: `${a * a} + ${b * b} = ${c * c}`, note: "Square each leg and add." },
            { latex: `c = ${c}`, note: "Take the positive square root." },
          ]
        : [
            { latex: `a^2 + b^2 = c^2`, note: "The hypotenuse is the side opposite the right angle." },
            { latex: `${a}^2 + b^2 = ${c}^2`, note: "Substitute what is known." },
            { latex: `b^2 = ${c * c} - ${a * a} = ${b * b}`, note: "Subtract — the missing side is a leg, so it comes off the hypotenuse." },
            { latex: `b = ${b}`, note: "Take the positive square root." },
          ];

      const base = {
        style: "drill" as const,
        difficulty,
        statement_latex: statement,
        hint: findHypotenuse
          ? "Square both legs, add, then take the root."
          : "The hypotenuse is the largest side — subtract, don't add.",
        explanation_steps: steps,
      };

      if (format === "mcq") {
        const mc = buildChoices(
          rng,
          answer,
          numericDistractors(Number(answer), [
            {
              value: findHypotenuse ? a + b : c - a,
              misconception: "Added or subtracted the sides directly instead of their squares.",
            },
            {
              value: findHypotenuse ? c * c : b * b,
              misconception: "Stopped at the squared value without taking the root.",
            },
            {
              value: findHypotenuse
                ? Math.round(Math.sqrt(Math.abs(b * b - a * a)))
                : Math.round(Math.sqrt(c * c + a * a)),
              misconception: findHypotenuse
                ? "Subtracted the squares instead of adding them."
                : "Added the squares instead of subtracting.",
            },
          ])
        );
        return { ...base, format: "mcq", ...mc };
      }
      return { ...base, format: "open", answer: numericAnswer(Number(answer)) };
    }

    // 45-45-90 and 30-60-90.
    const isoceles = difficulty === 3;
    const leg = rng.int(2, 12);

    if (isoceles) {
      const answer = `${leg}\\sqrt{2}`;
      const base = {
        style: "drill" as const,
        difficulty,
        statement_latex: `A \\(45^\\circ\\)-\\(45^\\circ\\)-\\(90^\\circ\\) triangle has legs of length \\(${leg}\\). Find the exact length of the hypotenuse.`,
        hint: "In a 45-45-90 triangle the sides are in the ratio \\(1 : 1 : \\sqrt{2}\\).",
        explanation_steps: [
          { latex: `1 : 1 : \\sqrt{2}`, note: "The side ratio for a 45-45-90 triangle." },
          { latex: `${leg}^2 + ${leg}^2 = c^2`, note: "Or derive it: both legs are equal." },
          { latex: `c^2 = ${2 * leg * leg}`, note: "Add the squares." },
          { latex: `c = ${answer}`, note: "The hypotenuse is the leg times root 2." },
        ],
      };
      if (format === "mcq") {
        const mc = buildChoices(rng, answer, [
          { latex: `${leg}\\sqrt{3}`, misconception: "Used the 30-60-90 ratio instead." },
          { latex: `\\frac{${leg}}{\\sqrt{2}}`, misconception: "Divided by root 2 — that shrinks the hypotenuse below the leg." },
          { latex: `${2 * leg}`, misconception: "Doubled the leg instead of scaling by root 2." },
        ]);
        return { ...base, format: "mcq", ...mc };
      }
      return {
        ...base,
        format: "open",
        answer: expressionAnswer(answer, [`${leg}sqrt(2)`, (leg * Math.SQRT2).toFixed(3)]),
      };
    }

    const answer = `${leg}\\sqrt{3}`;
    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: `In a \\(30^\\circ\\)-\\(60^\\circ\\)-\\(90^\\circ\\) triangle the shorter leg is \\(${leg}\\). Find the exact length of the longer leg.`,
      hint: "The sides are in the ratio \\(1 : \\sqrt{3} : 2\\), shortest first.",
      explanation_steps: [
        { latex: `1 : \\sqrt{3} : 2`, note: "Short leg, long leg, hypotenuse." },
        { latex: `\\text{short} = ${leg}`, note: "The short leg faces the 30-degree angle." },
        { latex: `\\text{long} = ${answer}`, note: "The long leg is the short leg times root 3." },
      ],
    };
    if (format === "mcq") {
      const mc = buildChoices(rng, answer, [
        { latex: `${2 * leg}`, misconception: "Gave the hypotenuse rather than the longer leg." },
        { latex: `${leg}\\sqrt{2}`, misconception: "Used the 45-45-90 ratio instead." },
        { latex: `\\frac{${leg}\\sqrt{3}}{2}`, misconception: "Halved the result — that is the ratio for a different side." },
      ]);
      return { ...base, format: "mcq", ...mc };
    }
    return {
      ...base,
      format: "open",
      answer: expressionAnswer(answer, [`${leg}sqrt(3)`, (leg * Math.sqrt(3)).toFixed(3)]),
    };
  },
};

/* ── Area and perimeter ──────────────────────────────────────────── */

export const areaPerimeter: Template = {
  id: "area-perimeter",
  topicSlugs: ["area-perimeter"],
  formats: ["open", "mcq"],
  difficulties: [1, 4],
  generate(rng: Rng, difficulty: number, format: ProblemFormat): GeneratedProblem {
    const shape =
      difficulty === 1
        ? "rectangle"
        : difficulty === 2
          ? rng.pick(["rectangle", "triangle"])
          : rng.pick(["triangle", "trapezoid", "circle"]);

    const w = rng.int(3, 14);
    // Distinct, so a "rectangle" is never described with two equal sides.
    let h = rng.int(3, 14);
    while (h === w) h = rng.int(3, 14);
    let b2 = rng.int(3, 14);
    while (b2 === w) b2 = rng.int(3, 14);
    const r = rng.int(2, 12);

    let answer: string;
    let statement: string;
    let steps: { latex: string; note: string }[];
    /** Numeric candidates for the measured shapes; the circle answers in pi. */
    let candidates: { value: number; misconception: string }[] = [];
    let piDistractors: { latex: string; misconception: string }[] = [];
    let numeric: number | null = null;

    if (shape === "rectangle") {
      const wantArea = difficulty === 1 || rng.next() < 0.5;
      numeric = wantArea ? w * h : 2 * (w + h);
      answer = `${numeric}`;
      statement = `A rectangle measures \\(${w}\\) by \\(${h}\\). Find its ${wantArea ? "area" : "perimeter"}.`;
      steps = wantArea
        ? [
            { latex: `A = \\text{length} \\times \\text{width}`, note: "Area of a rectangle." },
            { latex: `A = ${w} \\times ${h}`, note: "Substitute." },
            { latex: `A = ${w * h}`, note: "Multiply." },
          ]
        : [
            { latex: `P = 2(\\text{length} + \\text{width})`, note: "Perimeter goes around the outside." },
            { latex: `P = 2(${w} + ${h})`, note: "Substitute." },
            { latex: `P = ${2 * (w + h)}`, note: "Simplify." },
          ];
      candidates = [
        {
          value: wantArea ? 2 * (w + h) : w * h,
          misconception: wantArea
            ? "Found the perimeter instead of the area."
            : "Found the area instead of the perimeter.",
        },
        { value: w + h, misconception: "Added the two sides without doubling or multiplying." },
        { value: wantArea ? w * h * 2 : (w + h) * 4, misconception: "Doubled once too often." },
      ];
    } else if (shape === "triangle") {
      // Even base keeps the area an integer.
      const base2 = w % 2 === 0 ? w : w + 1;
      numeric = (base2 * h) / 2;
      answer = `${numeric}`;
      statement = `A triangle has base \\(${base2}\\) and height \\(${h}\\). Find its area.`;
      steps = [
        { latex: `A = \\frac{1}{2}bh`, note: "Area of a triangle." },
        { latex: `A = \\frac{1}{2}(${base2})(${h})`, note: "Substitute the base and the perpendicular height." },
        { latex: `A = ${numeric}`, note: "Simplify." },
      ];
      candidates = [
        { value: base2 * h, misconception: "Forgot the factor of one half." },
        { value: base2 + h, misconception: "Added the base and height instead of multiplying." },
        { value: (base2 + h) * 2, misconception: "Computed a perimeter-like quantity instead of an area." },
      ];
    } else if (shape === "trapezoid") {
      const b1 = w;
      const evenH = h % 2 === 0 ? h : h + 1;
      numeric = ((b1 + b2) * evenH) / 2;
      answer = `${numeric}`;
      statement = `A trapezoid has parallel sides \\(${b1}\\) and \\(${b2}\\), and height \\(${evenH}\\). Find its area.`;
      steps = [
        { latex: `A = \\frac{(b_1 + b_2)}{2}h`, note: "Average the parallel sides, then multiply by the height." },
        { latex: `A = \\frac{(${b1} + ${b2})}{2}(${evenH})`, note: "Substitute." },
        { latex: `A = ${(b1 + b2) / 2 === Math.round((b1 + b2) / 2) ? (b1 + b2) / 2 : `\\frac{${b1 + b2}}{2}`} \\times ${evenH}`, note: "Average first." },
        { latex: `A = ${numeric}`, note: "Multiply." },
      ];
      candidates = [
        { value: (b1 + b2) * evenH, misconception: "Forgot to halve the sum of the parallel sides." },
        { value: b1 * b2, misconception: "Multiplied the two parallel sides together." },
        { value: b1 + b2 + evenH, misconception: "Added the given lengths instead of using the area formula." },
      ];
    } else {
      answer = `${r * r}\\pi`;
      statement = `Find the exact area of a circle of radius \\(${r}\\).`;
      steps = [
        { latex: `A = \\pi r^2`, note: "Area of a circle." },
        { latex: `A = \\pi (${r})^2`, note: "Substitute the radius." },
        { latex: `A = ${r * r}\\pi`, note: "Square the radius — the pi stays exact." },
      ];
      piDistractors = [
        { latex: `${2 * r}\\pi`, misconception: "Used the circumference formula instead of the area." },
        { latex: `${2 * r * r}\\pi`, misconception: "Doubled the radius instead of squaring it." },
        { latex: `${r * r}`, misconception: "Dropped the pi." },
      ];
    }

    const base = {
      style: "drill" as const,
      difficulty,
      statement_latex: statement,
      hint:
        shape === "circle"
          ? "Area uses the radius squared; circumference uses the radius once."
          : shape === "triangle"
            ? "Half the base times the perpendicular height."
            : shape === "trapezoid"
              ? "Average the two parallel sides, then multiply by the height."
              : "Area multiplies the sides; perimeter adds them.",
      explanation_steps: steps,
    };

    if (format === "mcq") {
      const mc = buildChoices(
        rng,
        answer,
        numeric !== null ? numericDistractors(numeric, candidates) : piDistractors
      );
      return { ...base, format: "mcq", ...mc };
    }
    return {
      ...base,
      format: "open",
      answer:
        numeric !== null
          ? numericAnswer(numeric)
          : expressionAnswer(answer, [`${r * r}pi`, (r * r * Math.PI).toFixed(2)]),
    };
  },
};

/** Shared by the geometry templates that need a reduced ratio in a hint. */
export const reduce = (a: number, b: number) => {
  const g = gcd(a, b) || 1;
  return [a / g, b / g] as const;
};
