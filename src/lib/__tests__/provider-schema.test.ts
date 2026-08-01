import { describe, expect, it } from "vitest";
import { jsonSchemaFor } from "../ai/provider";
import {
  batchSchemaFor,
  repairSchemaFor,
  PROBLEM_FORMATS,
  SolverResultSchema,
  FeedbackResultSchema,
  EquivalenceResultSchema,
  CoachReadSchema,
} from "../ai/schemas";

/**
 * Gemini only supports `$ref` inside non-required properties, so every schema
 * we send must be fully inlined. A regression here fails at request time with
 * an opaque 400, so assert it up front.
 */
describe("model JSON schemas", () => {
  const schemas = [
    ...PROBLEM_FORMATS.map((f) => [`batch:${f}`, batchSchemaFor(f)] as const),
    ...PROBLEM_FORMATS.map((f) => [`repair:${f}`, repairSchemaFor(f)] as const),
    ["solver", SolverResultSchema] as const,
    ["feedback", FeedbackResultSchema] as const,
    ["equivalence", EquivalenceResultSchema] as const,
    ["coach", CoachReadSchema] as const,
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

  it("gives the solver a way to answer every format", () => {
    const json = jsonSchemaFor(SolverResultSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(json.properties)).toEqual(
      expect.arrayContaining(["chosen_choice_id", "chosen_choice_ids", "chosen_order"])
    );
  });
});
