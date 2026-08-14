/**
 * How much material one upload may carry, in one place.
 *
 * Its own module for the same reason `set-size.ts` is: the uploader is
 * `"use client"` and the caps lived in `materials.ts`, which imports the
 * service client. A component reading them from there would ship the key to
 * the browser, so it hand-copied all four instead — and a copy is only as good
 * as the day it was made.
 *
 * Three of the four still agreed. The byte cap did not, and it is the one where
 * disagreeing is invisible: the uploader refused a single file over 10 MB while
 * the reader stopped at 20 MB *across* files, so four 8 MB pages passed every
 * check the student could see and the last two were dropped from the digest
 * without anything saying so. Naming the two dimensions separately is what
 * stops that being spelled the same way twice.
 *
 * This file imports nothing.
 */

/** At most this many files in one upload. */
export const MAX_MATERIAL_FILES = 4;

/**
 * Per file, and the bound the student is told about. Sized for a phone photo
 * of a page, which is comfortably under it.
 */
export const MAX_MATERIAL_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Across all files, and the smaller constraint of the two — four files at the
 * per-file cap would be double this. It bounds what one model call is asked to
 * read, so the reader enforces it as well; the uploader checks it first only so
 * the student hears about it before waiting for an upload.
 */
export const MAX_MATERIAL_TOTAL_BYTES = 20 * 1024 * 1024;

/** How long a pasted excerpt may be before it is truncated. */
export const MAX_PASTED_CHARS = 20_000;

/** What the student may type about what they want next. */
export const MAX_WANT_CHARS = 280;
