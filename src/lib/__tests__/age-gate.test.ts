import { describe, expect, it } from "vitest";
import {
  affirmationRecord,
  MIN_AGE,
  MIN_AGE_STRICT,
  parseStoredAffirmation,
} from "../age-gate";

/**
 * The age declaration, which is stored in localStorage — writable by anything
 * on the origin — and which the privacy policy promises holds no date of birth.
 */

describe("age declaration", () => {
  it("accepts only a record it wrote itself", () => {
    // localStorage is writable by anything on the origin and outlives deploys,
    // so anything unrecognised has to mean "ask again" rather than "assume yes".
    expect(parseStoredAffirmation(JSON.stringify({ at: "2026-08-04T10:00:00.000Z" }))).toBe(true);
    expect(parseStoredAffirmation(null)).toBe(false);
    expect(parseStoredAffirmation("")).toBe(false);
    expect(parseStoredAffirmation("true")).toBe(false);
    expect(parseStoredAffirmation("{not json")).toBe(false);
    expect(parseStoredAffirmation(JSON.stringify({ at: "yesterday" }))).toBe(false);
    expect(parseStoredAffirmation(JSON.stringify({ at: 1754300000000 }))).toBe(false);
    expect(parseStoredAffirmation(JSON.stringify({}))).toBe(false);
  });

  it("records when it was given, and no date of birth", () => {
    const record = affirmationRecord(new Date("2026-08-04T10:00:00.000Z"));
    expect(record.age_affirmed_at).toBe("2026-08-04T10:00:00.000Z");
    expect(record.age_minimum_declared).toBe(MIN_AGE);
    // The privacy policy says a birth date is neither asked for nor stored, so
    // this object is what has to stay true to that.
    expect(Object.keys(record).sort()).toEqual(["age_affirmed_at", "age_minimum_declared"]);
  });

  it("states a minimum that matches the published policy", () => {
    expect(MIN_AGE).toBe(13);
    expect(MIN_AGE_STRICT).toBe(16);
  });
});
