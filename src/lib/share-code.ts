import { customAlphabet } from "nanoid";

/**
 * The code in a share link.
 *
 * The alphabet omits I, O, 0 and 1 so a code survives being read aloud or
 * copied off a screen. Eight characters over 31 symbols is ~8.5e11 codes, which
 * is what makes an unlisted link unguessable rather than merely unlisted.
 *
 * Its own module because every table that mints one (`problem_sets`, from three
 * different call sites) would otherwise keep a private copy, and two of them
 * drifting apart would mean two link formats.
 */
export const SHARE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const SHARE_CODE_LENGTH = 8;

const generate = customAlphabet(SHARE_CODE_ALPHABET, SHARE_CODE_LENGTH);

export function newShareCode(): string {
  return generate();
}

/** Normalize what a user typed or pasted, rejecting anything malformed. */
export function normalizeShareCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return new RegExp(`^[${SHARE_CODE_ALPHABET}]{${SHARE_CODE_LENGTH}}$`).test(code)
    ? code
    : null;
}
