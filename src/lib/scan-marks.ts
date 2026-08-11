/**
 * The one rule about a scanned mark that the browser also needs.
 *
 * It lives apart from `grade-scan.ts` for the same reason `kinds.ts` lives
 * apart from `schemas.ts`: that module opens with `import { z } from "zod"`, so
 * a client component importing this predicate from it would ship the whole zod
 * runtime to read two fields. Typed structurally rather than against `ScanMark`
 * so it needs no import at all — `grade-scan.ts` re-exports it, and the results
 * view calls it on real marks.
 */

/**
 * Did the student actually answer this one?
 *
 * A blank is "not attempted", which is not the same as "wrong", and the
 * difference is permanent: an unattempted problem recorded as a miss follows
 * the student through Stats, Review and the coach forever. Observed in
 * practice — a page numbered "6)" with nothing after it came back
 * `found: true, read_answer: "", correct: false, confidence: 1`, so the
 * confidence gate let it straight through. Confidence guards *misreading*; this
 * is a different failure, and it has to be decided here rather than trusted
 * from the model.
 */
export function wasAttempted(m: { found: boolean; read_answer: string }): boolean {
  return m.found && m.read_answer.trim().length > 0;
}
