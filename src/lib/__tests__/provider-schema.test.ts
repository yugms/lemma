import { describe, expect, it } from "vitest";
import { jsonSchemaFor } from "../ai/provider";
import {
  batchSchemaFor,
  repairSchemaFor,
  GENERATION_KINDS,
  SolverResultSchema,
  FeedbackResultSchema,
  EquivalenceResultSchema,
  CoachReadSchema,
  MaterialDigestSchema,
} from "../ai/schemas";

/**
 * Gemini only supports `$ref` inside non-required properties, so every schema
 * we send must be fully inlined. A regression here fails at request time with
 * an opaque 400, so assert it up front.
 */
describe("model JSON schemas", () => {
  const schemas = [
    // Keyed off generation kinds, not formats: `graph` is authored as three
    // separate schemas and each one is sent to a model on its own.
    ...GENERATION_KINDS.map((k) => [`batch:${k}`, batchSchemaFor(k)] as const),
    ...GENERATION_KINDS.map((k) => [`repair:${k}`, repairSchemaFor(k)] as const),
    ["solver", SolverResultSchema] as const,
    ["feedback", FeedbackResultSchema] as const,
    ["equivalence", EquivalenceResultSchema] as const,
    ["coach", CoachReadSchema] as const,
    ["material", MaterialDigestSchema] as const,
  ];

  it("are inlined, self-contained, and carry no $schema", () => {
    for (const [name, schema] of schemas) {
      const json = jsonSchemaFor(schema) as Record<string, unknown>;
      const text = JSON.stringify(json);
      expect(text.includes("$ref"), `${name} contains $ref`).toBe(false);
      expect(text.includes("$defs"), `${name} contains $defs`).toBe(false);
      expect(json.$schema, `${name} leaks $schema`).toBeUndefined();
      expect(json.type, `${name} is not an object schema`).toBe("object");
    }
  });

  const itemProps = (format: Parameters<typeof batchSchemaFor>[0]) => {
    const json = jsonSchemaFor(batchSchemaFor(format)) as {
      properties: { problems: { type: string; items: { properties: Record<string, unknown> } } };
    };
    expect(json.properties.problems.type).toBe("array");
    return Object.keys(json.properties.problems.items.properties);
  };

  it("describe the batch shape the generator expects", () => {
    expect(itemProps("mcq")).toEqual(
      expect.arrayContaining(["format", "choices", "correct_choice_id", "explanation_steps"])
    );
  });

  // The model is only ever sent one format's flat schema, so each new format
  // needs its own answer fields present or the authored problem is unusable.
  it("carries the select-all fields", () => {
    expect(itemProps("multi_select")).toEqual(
      expect.arrayContaining(["choices", "correct_choice_ids", "distractor_rationales"])
    );
  });

  it("carries the ordering fields", () => {
    expect(itemProps("ordering")).toEqual(
      expect.arrayContaining(["items", "correct_order"])
    );
  });

  it("carries the matching and multi-part fields", () => {
    expect(itemProps("matching")).toEqual(
      expect.arrayContaining(["left", "right", "correct_pairs"])
    );
    expect(itemProps("multi_part")).toEqual(expect.arrayContaining(["parts"]));
  });

  // Each graph kind must be shown its own answer field and no other, or the
  // model fills the wrong one and the problem is unanswerable.
  it("shows each graph kind only its own answer field", () => {
    expect(itemProps("graph_value")).toEqual(expect.arrayContaining(["plot", "answer"]));
    expect(itemProps("graph_value")).not.toContain("correct_points");
    expect(itemProps("graph_value")).not.toContain("target_curve");

    expect(itemProps("graph_points")).toEqual(
      expect.arrayContaining(["plot", "correct_points"])
    );
    expect(itemProps("graph_points")).not.toContain("target_curve");

    expect(itemProps("graph_sketch")).toEqual(
      expect.arrayContaining(["plot", "target_curve"])
    );
    expect(itemProps("graph_sketch")).not.toContain("correct_points");
  });

  /**
   * Observed against the live model: shown "Format: graph_points" in the
   * prompt, it wrote that string into both `format` and `response_kind`. Gemini
   * does not enforce `const`, so the literals came back wrong and a completely
   * correct problem — right plot, right integer points — was thrown away by
   * validation. Both fields are decided by which schema was requested, so they
   * are stamped rather than trusted.
   */
  it("stamps format and response_kind rather than trusting the model", () => {
    const authored = {
      problems: [
        {
          style: "drill",
          difficulty: 2,
          statement_latex: "Select the intercepts.",
          hint: null,
          explanation_steps: [{ latex: "x = 2", note: "Solve." }],
          format: "graph_points", // what the model actually emitted
          response_kind: "graph_points", // and here
          plot: {
            x_min: -5,
            x_max: 5,
            y_min: -5,
            y_max: 5,
            curves: [{ kind: "linear", coeffs: [1.5, 0] }],
            marks: [],
            show_grid: true,
          },
          correct_points: [{ x: 2, y: 3 }],
          topic_index: 0,
        },
      ],
    };

    const parsed = batchSchemaFor("graph_points").safeParse(authored);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const problem = parsed.data!.problems[0];
    expect(problem.format).toBe("graph");
    expect(problem.format === "graph" && problem.response_kind).toBe("points");
  });

  it("stamps the plain formats too", () => {
    const parsed = batchSchemaFor("mcq").safeParse({
      problems: [
        {
          style: "drill",
          difficulty: 2,
          statement_latex: "Solve.",
          hint: null,
          explanation_steps: [{ latex: "x = 1", note: "Solve." }],
          format: "multiple choice", // a model paraphrasing the format name
          choices: [
            { id: "A", latex: "1" },
            { id: "B", latex: "2" },
            { id: "C", latex: "3" },
          ],
          correct_choice_id: "A",
          distractor_rationales: [{ choice_id: "B", misconception: "Off by one." }],
          topic_index: 0,
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.problems[0].format).toBe("mcq");
  });

  it("gives the solver a way to answer every format", () => {
    const json = jsonSchemaFor(SolverResultSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toEqual(
      expect.arrayContaining([
        "chosen_choice_id",
        "chosen_choice_ids",
        "chosen_order",
        "chosen_pairs",
        "part_answers",
        "chosen_points",
        "chosen_curve",
      ])
    );
  });
});
