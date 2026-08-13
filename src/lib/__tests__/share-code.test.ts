import { describe, expect, it } from "vitest";
import { newShareCode, normalizeShareCode, SHARE_CODE_ALPHABET } from "../share-code";

/**
 * The public share-link guard. A loose regex here sends arbitrary strings from
 * a URL to the database, so the rejections matter more than the acceptances.
 */

describe("share codes", () => {
  it("mints codes from the read-aloud-safe alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newShareCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(SHARE_CODE_ALPHABET).toContain(ch);
    }
  });

  it("omits the characters that get misread", () => {
    for (const ambiguous of ["I", "O", "0", "1"]) {
      expect(SHARE_CODE_ALPHABET).not.toContain(ambiguous);
    }
  });

  it("accepts its own codes, in any case, with stray whitespace", () => {
    const code = newShareCode();
    expect(normalizeShareCode(code)).toBe(code);
    expect(normalizeShareCode(`  ${code.toLowerCase()}  `)).toBe(code);
  });

  it("rejects anything malformed before it reaches the database", () => {
    // This is what stops a share URL being used to probe with arbitrary
    // strings, so the rejections matter more than the acceptances.
    for (const bad of [
      "",
      "SHORT",
      "TOOLONGCODE",
      "ABCDEFG!",
      "ABCDEF01", // 0 and 1 are not in the alphabet
      "'; drop table problem_sets; --",
      "../../etc/passwd",
    ]) {
      expect(normalizeShareCode(bad), bad).toBeNull();
    }
  });
});
