import { describe, expect, it } from "vitest";
import type { AccountSummary } from "../account";

describe("account summary counts", () => {
  /**
   * The type is the contract here, so this is a type-level guard plus the two
   * rules that depend on it. `loadAccountSummary` itself hits the database and
   * is covered by `live-account.test.ts`.
   *
   * Background: this originally threw when a count failed, on the reasoning
   * that "0" is the one wrong answer before a permanent deletion. That was the
   * wrong fix — one flaky count then 500'd the page, and the page is the only
   * route to the deletion controls, so someone trying to erase their data found
   * the controls gone. It happened in production. `null` now means "unknown".
   */
  const unknown: AccountSummary = {
    sets: null,
    attempts: null,
    sessions: null,
    scans: null,
    materials: null,
    hasCoachRead: false,
  };

  const isEmpty = (n: number | null) => n === 0;

  it("never treats an unknown count as empty", () => {
    // Disabling a delete button on an unknown count tells someone there is
    // nothing to remove when there may well be.
    expect(isEmpty(unknown.attempts)).toBe(false);
    expect(isEmpty(unknown.sets)).toBe(false);
    expect(isEmpty(unknown.materials)).toBe(false);
    expect(isEmpty(0)).toBe(true);
  });

  it("distinguishes unknown from zero at the type level", () => {
    const empty: AccountSummary = {
      ...unknown,
      sets: 0,
      attempts: 0,
      sessions: 0,
      scans: 0,
      materials: 0,
    };
    expect(empty.sets).toBe(0);
    expect(unknown.sets).toBeNull();
    // A renderer showing `value ?? "—"` must produce a dash, not a zero.
    expect(unknown.sets ?? "—").toBe("—");
    expect(empty.sets ?? "—").toBe(0);
  });
});
