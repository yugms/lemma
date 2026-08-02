import { describe, expect, it } from "vitest";
import {
  ATTEMPT_MODES,
  MODE_LABELS,
  MODE_RULES,
  retryEligible,
  shouldDisclose,
  type AttemptMode,
} from "../attempt-state";

/**
 * The rule that decides whether a student is handed the answer key.
 *
 * `formats.test.ts` exercises this incidentally while checking formats; this
 * suite exists because the rule is load-bearing on its own. Two things must
 * hold no matter what changes around them: a quiz never discloses before it is
 * handed in, and a live retry offer never coexists with the answer — the second
 * attempt would otherwise be a copying exercise, which is precisely what the
 * wrong-answer path withholds the key to prevent.
 */

const wrong = { is_correct: false };
const right = { is_correct: true };
const revealed = { is_correct: null };

describe("mode table", () => {
  it("describes every mode exactly once", () => {
    for (const mode of ATTEMPT_MODES) {
      expect(MODE_RULES[mode], `${mode} has no rules`).toBeDefined();
      expect(MODE_LABELS[mode], `${mode} has no label`).toBeTruthy();
    }
    expect(Object.keys(MODE_RULES).sort()).toEqual([...ATTEMPT_MODES].sort());
    expect(Object.keys(MODE_LABELS).sort()).toEqual([...ATTEMPT_MODES].sort());
  });

  it("keeps a quiz silent until it is handed in", () => {
    expect(MODE_RULES.quiz.discloses).toBe(false);
    // A quiz that offered a retry would be disclosing the verdict by implication
    // — you would learn you were wrong from the button appearing.
    expect(MODE_RULES.quiz.offersRetry).toBe(false);
  });

  it("keeps flashcards out of a set's score", () => {
    // Stored unscoped, which is also what keeps repeated reps clear of the
    // one-row-per-attempt index.
    expect(MODE_RULES.flashcard.scored).toBe(false);
  });

  it("scores scanned work but never offers a retry on it", () => {
    // The paper is already written. A second attempt would be typed, which is a
    // different exercise from the one being marked.
    expect(MODE_RULES.scan).toMatchObject({ scored: true, offersRetry: false });
  });
});

describe("retryEligible", () => {
  it("offers a retry only after a genuinely wrong first answer", () => {
    expect(retryEligible("set-1", wrong, null, "practice")).toBe(true);
    expect(retryEligible("set-1", right, null, "practice")).toBe(false);
    // A reveal is a give-up, not a miss — there is nothing left to attempt.
    expect(retryEligible("set-1", revealed, null, "practice")).toBe(false);
    expect(retryEligible("set-1", null, null, "practice")).toBe(false);
  });

  it("offers it once", () => {
    expect(retryEligible("set-1", wrong, wrong, "practice")).toBe(false);
    expect(retryEligible("set-1", wrong, right, "practice")).toBe(false);
  });

  it("requires a set", () => {
    // The one-row-per-attempt index keys on set_id, so without one there is
    // nothing bounding a stream of "second" attempts.
    expect(retryEligible(null, wrong, null, "practice")).toBe(false);
  });

  it("is refused outright by every mode that does not teach", () => {
    for (const mode of ATTEMPT_MODES) {
      const eligible = retryEligible("set-1", wrong, null, mode);
      expect(eligible, `${mode}`).toBe(MODE_RULES[mode].offersRetry);
    }
  });

  it("defaults to practice when no mode is named", () => {
    expect(retryEligible("set-1", wrong, null)).toBe(true);
  });
});

describe("the answer key and a retry offer are mutually exclusive", () => {
  it("withholds while a retry stands, discloses once it does not", () => {
    expect(shouldDisclose(true)).toBe(false);
    expect(shouldDisclose(false)).toBe(true);
  });

  /**
   * The invariant stated directly: across every mode and every prior state,
   * there is no combination that both invites another attempt and hands over
   * the answer.
   */
  it("never both invites another attempt and discloses", () => {
    const priors = [null, wrong, right, revealed];
    for (const mode of ATTEMPT_MODES) {
      for (const first of priors) {
        for (const retry of priors) {
          for (const setId of ["set-1", null]) {
            const eligible = retryEligible(setId, first, retry, mode as AttemptMode);
            const discloses = MODE_RULES[mode].discloses && shouldDisclose(eligible);
            expect(
              eligible && discloses,
              `${mode} disclosed while offering a retry (first=${JSON.stringify(first)}, retry=${JSON.stringify(retry)}, set=${setId})`
            ).toBe(false);
          }
        }
      }
    }
  });
});
