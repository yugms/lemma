import { describe, expect, it } from "vitest";
import { describeSignInError, SIGN_IN_FALLBACK } from "../auth-errors";

/**
 * Sign-in failure copy. An unmapped code shows a blank sentence, and the two
 * codes named here are dashboard settings that are invisible from the code —
 * so the page naming the cause is the only debugging aid there is.
 */

describe("sign-in error copy", () => {
  it("always returns a sentence", () => {
    for (const code of [undefined, null, "", "something_new_from_supabase"]) {
      expect(describeSignInError(code)).toBe(SIGN_IN_FALLBACK);
    }
    expect(SIGN_IN_FALLBACK.length).toBeGreaterThan(0);
  });

  it("names the two failures that actually happened on this project", () => {
    // Both were hit in production and cost real debugging time: manual linking
    // is off by default, and the provider has to be switched on separately.
    const linking = describeSignInError("manual_linking_disabled");
    expect(linking).not.toBe(SIGN_IN_FALLBACK);
    expect(linking).toMatch(/manual linking/i);

    const provider = describeSignInError("provider_disabled");
    expect(provider).not.toBe(SIGN_IN_FALLBACK);
    expect(provider).toMatch(/google/i);
  });

  it("reassures the student their guest work survives, where that is true", () => {
    // The failures where nothing was lost should say so — a guest who thinks
    // their sets are gone has no reason to try again.
    for (const code of ["manual_linking_disabled", "unexpected_failure"]) {
      expect(describeSignInError(code).length).toBeGreaterThan(20);
    }
    expect(SIGN_IN_FALLBACK).toMatch(/safe/i);
  });
});
