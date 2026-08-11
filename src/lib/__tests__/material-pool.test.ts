import { describe, expect, it } from "vitest";
import { contentHashFor, rowFromGenerated } from "@/lib/sets";
import type { GeneratedProblem } from "@/lib/ai/schemas";

/**
 * Keeping problems written from one student's upload out of everyone else's
 * pool.
 *
 * Two things do that together, and only one of them is obvious. `status` is the
 * obvious one: the pool query filters it, and `problems_pick` is a partial
 * index over `status = 'active'`, so an `unlisted` row is invisible to reuse at
 * no cost. The hash namespace is the one that looks redundant and is not — see
 * `contentHashFor`.
 */

const problem = {
  style: "drill",
  format: "open",
  response_kind: "numeric",
  difficulty: 2,
  statement_latex: "Factor \\(x^2 + 5x + 6\\).",
  hint: null,
  explanation_steps: [{ latex: "(x+2)(x+3)", note: "Find the pair summing to 5." }],
  answer: { kind: "numeric", value_latex: "(x+2)(x+3)", acceptable_forms: [] },
} as unknown as GeneratedProblem;

const TOPIC = "11111111-1111-1111-1111-111111111111";

describe("material problems get their own hash space", () => {
  it("cannot collide with a pool problem", () => {
    // `insertProblems` upserts on (topic_id, content_hash), and PostgREST
    // compiles that to ON CONFLICT DO UPDATE SET *every column in the payload*.
    // Sharing a hash therefore overwrites rather than skips, and `status` is
    // the column where the two rows disagree: without this namespace one
    // material build demotes a shared, verified pool problem to `unlisted` for
    // everyone, and one later ordinary build promotes a material problem to
    // `active` and serves somebody's homework to strangers. Both silently.
    expect(contentHashFor(problem, null, "mat-1")).not.toBe(contentHashFor(problem, null));
  });

  it("separates one material from another", () => {
    expect(contentHashFor(problem, null, "mat-1")).not.toBe(
      contentHashFor(problem, null, "mat-2")
    );
  });

  it("still dedups within one material", () => {
    // The remaining collisions are the ones worth having: asking the same
    // material for a second set should not store the same problem twice.
    expect(contentHashFor(problem, null, "mat-1")).toBe(contentHashFor(problem, null, "mat-1"));
  });

  it("leaves the ordinary hash alone", () => {
    expect(contentHashFor(problem, null)).toBe(contentHashFor(problem, null, undefined));
    expect(contentHashFor(problem, "tmpl#1")).not.toBe(contentHashFor(problem, null));
  });
});

describe("rows carry a status", () => {
  it("marks a material problem unlisted and everything else active", () => {
    expect(rowFromGenerated(problem, TOPIC, "ai", null, null).status).toBe("active");
    expect(rowFromGenerated(problem, TOPIC, "ai", null, null, "mat-1").status).toBe("unlisted");
  });

  it("puts the column on every row, so an array insert cannot null it", () => {
    // supabase-js sends an array insert as one statement with a shared column
    // list, so a key present on only some rows arrives as NULL on the rest —
    // and `problems.status` is NOT NULL.
    const rows = [
      rowFromGenerated(problem, TOPIC, "ai", null, null),
      rowFromGenerated(problem, TOPIC, "ai", null, null, "mat-1"),
      rowFromGenerated(problem, TOPIC, "template", "tmpl#1", null),
    ];

    for (const row of rows) expect(row.status).toBeDefined();
  });
});
