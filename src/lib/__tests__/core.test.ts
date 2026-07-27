import { describe, expect, it } from "vitest";
import { checkMultiAnswer, checkOpenAnswer, normalizeMath, parseNumeric } from "../answers";
import { structuralCheck } from "../ai/verify";
import { instantiate, templates } from "../templates";
import type { OpenAnswer } from "../ai/schemas";

const numeric = (value: number, latex?: string): OpenAnswer => ({
  value_latex: latex ?? String(value),
  kind: "numeric",
  numeric_value: value,
  tolerance: null,
  acceptable_forms: [],
  multi_valued: false,
});

describe("normalizeMath", () => {
  it("normalizes fractions and radicals", () => {
    expect(normalizeMath("\\frac{3}{4}")).toBe("3/4");
    expect(normalizeMath("\\sqrt{2}")).toBe("sqrt(2)");
    expect(normalizeMath("2\\cdot x^{3}")).toBe("2*x^3");
  });
  it("strips a leading assignment", () => {
    expect(normalizeMath("x = 5")).toBe("5");
  });
});

describe("parseNumeric", () => {
  it("parses fractions and decimals", () => {
    expect(parseNumeric("(3)/(4)")).toBeCloseTo(0.75);
    expect(parseNumeric("-2.5")).toBe(-2.5);
    expect(parseNumeric("sqrt(2)")).toBeNull();
  });
});

describe("checkOpenAnswer", () => {
  it("accepts equal numerics in different forms", () => {
    expect(checkOpenAnswer("5", numeric(5, "x = 5"))).toBe("correct");
    expect(checkOpenAnswer("x=5", numeric(5, "x = 5"))).toBe("correct");
    expect(checkOpenAnswer("0.75", numeric(0.75, "\\frac{3}{4}"))).toBe("correct");
    expect(checkOpenAnswer("3/4", numeric(0.75, "\\frac{3}{4}"))).toBe("correct");
  });
  it("rejects wrong numerics", () => {
    expect(checkOpenAnswer("6", numeric(5))).toBe("incorrect");
  });
  it("handles order-independent multi answers", () => {
    const ans: OpenAnswer = {
      value_latex: "x = 2,\\ x = -5",
      kind: "expression",
      numeric_value: null,
      tolerance: null,
      acceptable_forms: [],
      multi_valued: true,
    };
    expect(checkMultiAnswer("-5, 2", ans)).toBe("correct");
    expect(checkMultiAnswer("x=2, x=-5", ans)).toBe("correct");
    expect(checkMultiAnswer("2, 5", ans)).toBe("incorrect");
  });
});

describe("templates", () => {
  it("produce structurally valid problems across seeds, difficulties, and formats", () => {
    for (const template of templates) {
      for (let d = template.difficulties[0]; d <= template.difficulties[1]; d++) {
        for (const format of template.formats) {
          for (let seed = 1; seed <= 25; seed++) {
            const { problem } = instantiate(template, format, d, seed * 7919);
            const check = structuralCheck(problem);
            expect(
              check.ok,
              `${template.id} d${d} ${format} seed=${seed * 7919}: ${check.reason}`
            ).toBe(true);
            expect(problem.difficulty).toBe(d);
          }
        }
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const t = templates[0];
    const a = instantiate(t, "open", 2, 12345);
    const b = instantiate(t, "open", 2, 12345);
    expect(a.problem).toEqual(b.problem);
    expect(a.templateId).toBe(b.templateId);
  });
});
