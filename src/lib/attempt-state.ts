/**
 * When a second attempt is on offer, and what that means for disclosure.
 *
 * Pure and separate from the route because the rule is load-bearing in two
 * directions at once: it decides whether the student is invited to try again,
 * and it decides whether the answer key is in the response. Those must never
 * disagree — handing over the key beside a "Try again" button turns the second
 * attempt into a copying exercise, which is the whole reason the wrong-answer
 * path withholds it.
 */

export type AttemptRecord = { is_correct: boolean | null };

export const ATTEMPT_MODES = ["practice", "flashcard", "quiz", "scan"] as const;
export type AttemptMode = (typeof ATTEMPT_MODES)[number];

export const MODE_LABELS: Record<AttemptMode, string> = {
  practice: "Practice",
  quiz: "Quizzes",
  flashcard: "Flashcards",
  scan: "Scanned work",
};

/**
 * What each mode is, expressed as the three questions the grading route has to
 * answer about it.
 *
 * - `scored` — is this attempt part of a set's record? Practice and quiz are;
 *   flashcards are repeatable drilling, so they are stored unscoped and never
 *   move a set's score. That is also what keeps them clear of the
 *   one-row-per-attempt index, which only covers set-scoped rows.
 * - `discloses` — does the response carry the answer? A quiz withholds
 *   everything until it is handed in; that is what makes it a quiz.
 * - `offersRetry` — practice teaches, so a miss earns a second attempt. A quiz
 *   is an assessment and a flashcard is already infinitely repeatable.
 */
export const MODE_RULES: Record<
  AttemptMode,
  { scored: boolean; discloses: boolean; offersRetry: boolean }
> = {
  practice: { scored: true, discloses: true, offersRetry: true },
  quiz: { scored: true, discloses: false, offersRetry: false },
  flashcard: { scored: false, discloses: true, offersRetry: false },
  // Work done on paper and photographed. Scored, because it is a record of
  // working through the set once — the same thing practice records. No retry:
  // the paper is already written, and a second attempt at it would be typed,
  // which is a different exercise from the one being marked.
  scan: { scored: true, discloses: true, offersRetry: false },
};

/**
 * The modes that count as evidence about what a student can do.
 *
 * Derived rather than listed, so a new mode is classified once. Anything
 * reading practice history — the review queue especially — has to filter on
 * this: a flashcard is repeatable with the solution one click away, so a rep
 * that happens to go well says nothing about whether a gap closed.
 */
export const SCORED_MODES = ATTEMPT_MODES.filter((m) => MODE_RULES[m].scored);

export function retryEligible(
  setId: string | null,
  first: AttemptRecord | null,
  retry: AttemptRecord | null,
  mode: AttemptMode = "practice"
): boolean {
  // Only a genuinely wrong first answer earns one: a reveal (`null`) is a
  // give-up, and a retry is offered once. Set scoping is required because the
  // one-row-per-attempt index keys on it — without a set there is nothing
  // stopping an unbounded stream of "second" attempts.
  if (!MODE_RULES[mode].offersRetry) return false;
  return Boolean(setId) && first?.is_correct === false && !retry;
}

/** The answer key and a live retry offer are mutually exclusive. */
export function shouldDisclose(eligible: boolean): boolean {
  return !eligible;
}
