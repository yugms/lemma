import { describe, expect, it } from "vitest";
import { inlineShape, prepareProblem, renderInline, renderProse } from "../math-render";
import { structuralCheck } from "../ai/verify";
import type { GeneratedProblem, SanitizedProblem } from "../ai/schemas";

/**
 * What a model actually writes into the `latex` fields, versus what the
 * renderers assumed it would write.
 *
 * Three formats shipped unreadable to production because the assumption was
 * baked in per field: `choices` went through `renderMath`, so a select-all
 * choice — which is a sentence by definition — came out as one math run with
 * the spaces between its words removed; `items` and the matching columns went
 * through `renderProse`, so a step that is purely an equation showed its own
 * source. Neither field has a single shape, so these cover both shapes for
 * each, and the delimiter convention on top.
 */

/** KaTeX wraps everything it renders; its absence means source text. */
const rendered = (html: string) => html.includes('class="katex"');

describe("renderInline", () => {
  it("renders an undelimited expression as math", () => {
    const html = renderInline("y = -\\frac{15 \\cdot 6}{8 \\cdot 5}");
    expect(rendered(html)).toBe(true);
    // The old behaviour emitted the source as escaped text, so the string
    // began with the expression rather than with KaTeX's wrapper.
    expect(html.startsWith("<span")).toBe(true);
  });

  it("keeps the words in a sentence, and still renders the math inside it", () => {
    const html = renderInline(
      "The portion of students who play an instrument is \\frac{7}{25}."
    );
    // Words survive as text — under `renderMath` they became one italic run
    // with every space dropped.
    expect(html.startsWith("The portion of students who play an instrument is")).toBe(true);
    expect(rendered(html)).toBe(true);
  });

  it("renders a numeric quantity together with the macro that follows it", () => {
    const html = renderInline("The percentage of students is 28\\%.");
    expect(html.startsWith("The percentage of students is")).toBe(true);
    expect(rendered(html)).toBe(true);
    // The number belongs to the expression, not to the sentence.
    expect(html).not.toMatch(/is 28\s*<span/);
  });

  it("honours the \\( \\) convention when the author used it", () => {
    const html = renderInline("divide both sides by \\(3\\)");
    expect(html.startsWith("divide both sides by")).toBe(true);
    expect(rendered(html)).toBe(true);
  });

  it("leaves a phrase with no math as plain text", () => {
    expect(renderInline("the power rule")).toBe("the power rule");
  });

  it("renders a bare number as math, not as a stray word", () => {
    expect(rendered(renderInline("0.625"))).toBe(true);
  });

  it("escapes markup in prose", () => {
    expect(renderInline("pick <b>two</b> of these")).toContain("&lt;b&gt;");
  });
});

describe("renderProse", () => {
  it("renders undelimited macros embedded in prose", () => {
    expect(rendered(renderProse("passes through \\frac{1}{2} exactly"))).toBe(true);
  });

  it("does not leave escaped newlines in the copy", () => {
    // The model writes "\\n\\n" in its JSON; what survives decoding is a
    // backslash and an "n", which was rendering verbatim mid-question.
    const html = renderProse("Solve for y:\\n\\nOrder the steps below.");
    expect(html).not.toContain("\\n");
    expect(html).toContain("Order the steps below.");
  });

  it("does not mistake a real macro for an escape sequence", () => {
    // \neq and \nu both begin the way \n does.
    expect(renderProse("\\(a \\neq b\\)")).toContain("\\neq");
    expect(renderProse("\\(\\nu\\)")).toContain("\\nu");
  });

  it("still handles display math and blank placeholders", () => {
    expect(renderProse("so \\[x = 2\\]")).toContain("block");
    expect(renderProse("x = {{1}}")).toContain("font-mono");
  });
});

describe("structuralCheck agrees with the renderer", () => {
  /**
   * The checker and the renderer have to read a fragment the same way. When
   * they did not, telling the model that select-all choices are sentences —
   * which they are — meant every one it wrote was rejected before delivery,
   * because the checker still demanded that the whole string parse as one
   * LaTeX expression.
   */
  const selectAll = (choices: { id: "A" | "B" | "C" | "D"; latex: string }[]): GeneratedProblem => ({
    format: "multi_select",
    style: "conceptual",
    difficulty: 2,
    statement_latex: "Select every true statement.",
    hint: null,
    explanation_steps: [{ latex: "", note: "Check each one." }],
    choices,
    correct_choice_ids: ["A"],
    distractor_rationales: [
      { choice_id: "B", misconception: "Confused the two." },
      { choice_id: "C", misconception: "Dropped a factor." },
      { choice_id: "D", misconception: "Used the wrong base." },
    ],
  });

  it("accepts select-all choices written as sentences", () => {
    const result = structuralCheck(
      selectAll([
        { id: "A", latex: "The portion who play is \\(\\frac{7}{25}\\)." },
        { id: "B", latex: "The portion who play is equivalent to \\(2.8\\%\\)." },
        { id: "C", latex: "The portion who do not play is \\(0.72\\)." },
        { id: "D", latex: "The percentage who play is \\(28\\%\\)." },
      ])
    );
    expect(result).toEqual({ ok: true });
  });

  it("accepts select-all choices written with undelimited math", () => {
    const result = structuralCheck(
      selectAll([
        { id: "A", latex: "The portion who play is \\frac{7}{25}." },
        { id: "B", latex: "The portion who play is 2.8\\%." },
        { id: "C", latex: "The portion who do not play is 0.72." },
        { id: "D", latex: "The percentage who play is 28\\%." },
      ])
    );
    expect(result).toEqual({ ok: true });
  });

  it("still accepts bare expressions", () => {
    const result = structuralCheck(
      selectAll([
        { id: "A", latex: "\\frac{7}{25}" },
        { id: "B", latex: "0.28" },
        { id: "C", latex: "28\\%" },
        { id: "D", latex: "\\frac{18}{25}" },
      ])
    );
    expect(result).toEqual({ ok: true });
  });

  it("still rejects two choices that say the same thing", () => {
    const result = structuralCheck(
      selectAll([
        { id: "A", latex: "The portion who play is one quarter." },
        { id: "B", latex: "The portion who play is one quarter." },
        { id: "C", latex: "0.72" },
        { id: "D", latex: "\\frac{18}{25}" },
      ])
    );
    expect(result.ok).toBe(false);
  });

  it("classifies every shape the checker and renderer share", () => {
    expect(inlineShape("\\frac{5}{8}")).toBe("math");
    expect(inlineShape("The portion who play is \\frac{7}{25}.")).toBe("prose");
    expect(inlineShape("divide both sides by \\(3\\)")).toBe("prose");
    expect(inlineShape("the power rule")).toBe("prose");
    expect(inlineShape("   ")).toBe("empty");
  });

  it("reads a word and a number as a label, not an expression", () => {
    // Error-analysis choices name the step that went wrong; in math mode the
    // space vanishes and the reader is offered `Step1`.
    expect(inlineShape("Step 1")).toBe("prose");
    expect(inlineShape("Option 2.")).toBe("prose");
    expect(inlineShape("Line 12)")).toBe("prose");
    // Still expressions: the pattern only fires when there is nothing else.
    expect(inlineShape("x 2")).toBe("math");
    expect(inlineShape("2x + 1")).toBe("math");
    expect(inlineShape("\\log_2 8")).toBe("math");
    expect(inlineShape("Step 1: divide by \\(3\\)")).toBe("prose");
  });
});

describe("prepareProblem", () => {
  const base = {
    id: "p1",
    position: 1,
    style: "drill" as const,
    difficulty: 2,
    statement_latex: "Work it through.",
    hint: null,
  };

  it("renders ordering steps written as bare equations", () => {
    const p = prepareProblem({
      ...base,
      format: "ordering",
      items: [
        { id: "A", latex: "y = -\\frac{9}{4}" },
        { id: "B", latex: "multiply both sides by \\(-\\frac{6}{5}\\)" },
      ],
    } satisfies SanitizedProblem);
    expect(rendered(p.items![0].html)).toBe(true);
    expect(rendered(p.items![1].html)).toBe(true);
    expect(p.items![1].html.startsWith("multiply both sides by")).toBe(true);
  });

  it("renders select-all choices as sentences", () => {
    const p = prepareProblem({
      ...base,
      format: "multi_select",
      choices: [
        { id: "A", latex: "The portion who play an instrument is \\frac{7}{25}." },
        { id: "B", latex: "\\frac{3}{8}" },
      ],
    } satisfies SanitizedProblem);
    expect(p.choices![0].html.startsWith("The portion who play an instrument is")).toBe(true);
    expect(rendered(p.choices![1].html)).toBe(true);
  });

  it("renders matching columns written as bare expressions", () => {
    const p = prepareProblem({
      ...base,
      format: "matching",
      left: [{ id: "A", latex: "\\frac{5}{8}" }],
      right: [
        { id: "1", latex: "0.625" },
        { id: "2", latex: "the power rule" },
      ],
    } satisfies SanitizedProblem);
    expect(rendered(p.left![0].html)).toBe(true);
    expect(rendered(p.right![0].html)).toBe(true);
    expect(p.right![1].html).toBe("the power rule");
  });
});
