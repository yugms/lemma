import { describe, expect, it } from "vitest";
import { jsonSchemaFor } from "../ai/provider";
import {
  batchSchemaFor,
  repairSchemaFor,
  PROBLEM_FORMATS,
  SolverResultSchema,
  FeedbackResultSchema,
  EquivalenceResultSchema,
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

  it("describe the batch shape the generator expects", () => {
    const json = jsonSchemaFor(batchSchemaFor("mcq")) as {
      properties: { problems: { type: string; items: { properties: Record<string, unknown> } } };
    };
    expect(json.properties.problems.type).toBe("array");
    const item = json.properties.problems.items.properties;
    expect(Object.keys(item)).toEqual(
      expect.arrayContaining(["format", "choices", "correct_choice_id", "explanation_steps"])
    );
  });
});
