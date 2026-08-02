import { describe, expect, it } from "vitest";
import { wasAttempted, SCAN_CONFIDENCE_THRESHOLD, type ScanMark } from "../ai/grade-scan";

const mark = (over: Partial<ScanMark>): ScanMark => ({
  problem_number: 1,
  found: true,
  read_answer: "x = 5",
  correct: true,
  confidence: 1,
  note: "",
  ...over,
});

/**
 * Scanned work becomes permanent history, so the rule that decides what gets
 * written matters more than the marking itself. A wrong answer the student
 * never gave follows them through Stats, Review and the coach.
 */
describe("what a scan is allowed to record", () => {
  it("does not count a numbered-but-empty answer as an attempt", () => {
    // The exact payload observed from the live model: a page with "6)" written
    // and nothing after it. found=true and confidence=1, because the model was
    // certain it had read a blank correctly — so the confidence gate passed it
    // straight through and it was recorded as a miss.
    expect(
      wasAttempted(
        mark({ problem_number: 6, found: true, read_answer: "", correct: false, confidence: 1 })
      )
    ).toBe(false);
  });

  it("treats whitespace as blank", () => {
    expect(wasAttempted(mark({ read_answer: "   " }))).toBe(false);
  });

  it("does not count a problem missing from the page", () => {
    expect(wasAttempted(mark({ found: false, read_answer: "" }))).toBe(false);
  });

  it("counts a real answer, right or wrong", () => {
    expect(wasAttempted(mark({ read_answer: "x = 5", correct: true }))).toBe(true);
    expect(wasAttempted(mark({ read_answer: "x = 4", correct: false }))).toBe(true);
  });

  it("is independent of confidence", () => {
    // Confidence gates *misreading*; attempted-ness is a separate question, and
    // conflating them is what let the blank through.
    expect(wasAttempted(mark({ read_answer: "x = 5", confidence: 0.1 }))).toBe(true);
    expect(wasAttempted(mark({ read_answer: "", confidence: 1 }))).toBe(false);
  });

  it("keeps the confidence threshold strict enough to be worth having", () => {
    expect(SCAN_CONFIDENCE_THRESHOLD).toBeGreaterThan(0.5);
    expect(SCAN_CONFIDENCE_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
