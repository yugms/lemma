/**
 * How many problems a set may hold, in one place.
 *
 * There were three answers to this and no way to tell which was the rule: the
 * route accepted 1-15, the builder offered 3-12, and the material review
 * offered 4-12. Nothing enforced agreement, so the two client bounds were free
 * to drift from each other and from the server — and the one that matters is
 * invisible from either client.
 *
 * Its own module because the clients are `"use client"` and the server bound
 * lives in `sets.ts`, which imports the whole generation pipeline. A component
 * reading the number from there would drag the AI graph into the browser
 * bundle; this file imports nothing.
 */

/**
 * The hard bound. Above this a build cannot finish inside the route's
 * `maxDuration`, so it is enforced server-side — by the request schema and
 * again by `buildProblemSet`, which clamps rather than rejects.
 */
export const MAX_SET_COUNT = 15;

/**
 * What the builders actually offer, which is deliberately below the hard bound:
 * a set is something a student sits down and finishes, and the last three
 * problems of a fifteen are where that stops being true. Raising this is a
 * product decision; raising `MAX_SET_COUNT` is a latency one.
 */
export const MIN_BUILDER_COUNT = 3;
export const MAX_BUILDER_COUNT = 12;
