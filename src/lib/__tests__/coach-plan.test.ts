import { describe, expect, it } from "vitest";
import { prescribe, PLAN_IDS, type PlanId } from "../coach-plan";
import type { MistakeNote, StatsSnapshot, TopicStat } from "../analytics";
import { PROBLEM_FORMATS, PROBLEM_STYLES } from "../ai/schemas";

/**
 * Targeted set configuration.
 *
 * This is a security boundary as much as a feature. `config.focus.directives`
 * lands verbatim in a model prompt, and a targeted build accepts only a plan
 * id from the client — everything else is rebuilt here from the caller's own
 * history. So the thing worth testing is not that the copy reads well, but
 * that what comes out is always a config the generator can safely act on:
 * real topic ids, a difficulty in range, and formats and styles the enum
 * actually contains.
 */

function topic(over: Partial<TopicStat> = {}): TopicStat {
  return {
    topicId: "11111111-1111-4111-8111-111111111111",
    slug: "quadratics",
    title: "Quadratics",
    unitTitle: "Polynomials",
    courseTitle: "Algebra 2",
    attempted: 12,
    correct: 4,
    revealed: 1,
    recovered: 2,
    accuracy: 33,
    difficulty: 3,
    weakestFormat: "open",
    weakestStyle: "word",
    lastAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

function snapshot(over: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    totals: {
      answered: 40,
      correct: 20,
      revealed: 2,
      recovered: 5,
      accuracy: 50,
      medianTimeMs: 45_000,
      problems: 38,
    },
    streak: { current: 3, best: 7 },
    activity: [],
    byTopic: [topic()],
    byMode: [],
    byFormat: [],
    byStyle: [],
    byDifficulty: [{ key: "3", label: "Level 3", attempted: 20, correct: 15, accuracy: 75 }],
    weakest: [topic()],
    strongest: [topic({ accuracy: 90, correct: 11 })],
    stale: [],
    ceiling: 3,
    mistakes: [],
    lastAttemptAt: new Date().toISOString(),
    ...over,
  };
}

describe("prescribe", () => {
  it("produces nothing from an empty record", () => {
    // "Designed for you" has to mean something. With no history there is no
    // signal, and offering a plan anyway would be a lie the student pays a
    // daily set slot for.
    const plans = prescribe(
      snapshot({ weakest: [], strongest: [], stale: [], byTopic: [], ceiling: null }),
      null
    );
    expect(plans).toEqual([]);
  });

  it("only ever returns known plan ids", () => {
    const plans = prescribe(snapshot(), null);
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(PLAN_IDS).toContain(plan.id);
    }
    // The route resolves the client's id against this list, so duplicates would
    // make `.find()` pick arbitrarily between two different configs.
    const ids = plans.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits a config the generator can actually build", () => {
    for (const plan of prescribe(snapshot(), null)) {
      const { config } = plan;
      expect(config.topicIds.length, `${plan.id} has no topics`).toBeGreaterThan(0);
      expect(config.topicIds.length).toBeLessThanOrEqual(6);
      expect(config.count).toBeGreaterThan(0);
      expect(config.count).toBeLessThanOrEqual(15);
      expect(config.difficulty).toBeGreaterThanOrEqual(1);
      expect(config.difficulty).toBeLessThanOrEqual(5);
      expect(config.styles.length, `${plan.id} has no styles`).toBeGreaterThan(0);
      expect(config.formats.length, `${plan.id} has no formats`).toBeGreaterThan(0);
      // The API route validates these against the same enums, so anything
      // outside them is a 400 the student sees as "targeted sets are broken".
      for (const style of config.styles) expect(PROBLEM_STYLES).toContain(style);
      for (const format of config.formats) expect(PROBLEM_FORMATS).toContain(format);
    }
  });

  it("carries at least one directive that only this record could have produced", () => {
    const plans = prescribe(snapshot(), null);
    for (const plan of plans) {
      const directives = plan.config.focus?.directives ?? [];
      expect(directives.length, `${plan.id} has no directives`).toBeGreaterThan(0);
      expect(directives.join(" ")).toContain("Quadratics");
    }
  });

  it("stands on its own when the coach model is unavailable", () => {
    // The coach read is the part that can fail — callStructured returns null on
    // unusable output. A prescription with no directives left would be an
    // ordinary set sold as a targeted one.
    const withoutCoach = prescribe(snapshot(), null);
    expect(withoutCoach.length).toBeGreaterThan(0);
    for (const plan of withoutCoach) {
      expect((plan.config.focus?.directives ?? []).length).toBeGreaterThan(0);
    }
  });

  it("appends the coach's directives to the computed ones rather than replacing them", () => {
    const coachLine = "Insist on exact surd form throughout.";
    const withCoach = prescribe(snapshot(), {
      generator_directives: [coachLine],
    } as never);
    const plan = withCoach[0];
    const directives = plan.config.focus?.directives ?? [];
    expect(directives).toContain(coachLine);
    expect(directives.length).toBeGreaterThan(1);
  });

  it("only quotes mistake notes from topics the set actually covers", () => {
    // A note about trigonometry is not a constraint on a set of quadratics, and
    // sending it would have the generator writing to the wrong evidence.
    const mistakes: MistakeNote[] = [
      { topicTitle: "Quadratics", note: "Drops the negative root", at: "", count: 2 },
      { topicTitle: "Trigonometry", note: "Confuses sin and cos", at: "", count: 5 },
    ];
    for (const plan of prescribe(snapshot({ mistakes }), null)) {
      const joined = (plan.config.focus?.directives ?? []).join(" ");
      expect(joined).not.toContain("Confuses sin and cos");
    }
  });

  it("flattens quotes out of a mistake note before it reaches a prompt", () => {
    // The note is model-authored and is embedded in a quoted string inside
    // another prompt, so an unescaped quote or newline changes the instruction
    // the generator reads.
    const mistakes: MistakeNote[] = [
      {
        topicTitle: "Quadratics",
        note: 'Wrote "x = 2" then\n  ignored the second root',
        at: "",
        count: 1,
      },
    ];
    const joined = (prescribe(snapshot({ mistakes }), null)[0].config.focus?.directives ?? []).join(
      " "
    );
    const quoted = joined.slice(joined.indexOf("The grader's note reads"));
    expect(quoted).not.toContain("\n");
    expect(quoted.match(/"/g)?.length).toBe(2);
  });

  it("offers a step up only when a level has demonstrably been cleared", () => {
    const hasStretch = (s: StatsSnapshot) =>
      prescribe(s, null).some((p) => p.id === ("stretch" satisfies PlanId));

    expect(hasStretch(snapshot({ ceiling: 3 }))).toBe(true);
    // Nothing cleared yet — "harder" is meaningless.
    expect(hasStretch(snapshot({ ceiling: null }))).toBe(false);
    // Already at the top; there is nowhere to step up to.
    expect(hasStretch(snapshot({ ceiling: 5 }))).toBe(false);
  });

  it("never proposes a difficulty outside the scale, even at the ceiling", () => {
    for (const ceiling of [null, 1, 2, 3, 4, 5]) {
      for (const plan of prescribe(snapshot({ ceiling }), null)) {
        expect(plan.config.difficulty, `ceiling ${ceiling}`).toBeGreaterThanOrEqual(1);
        expect(plan.config.difficulty, `ceiling ${ceiling}`).toBeLessThanOrEqual(5);
      }
    }
  });
});
