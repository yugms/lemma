import type { StatsSnapshot, TopicStat } from "@/lib/analytics";
import type { SetConfig } from "@/lib/sets";
import type { CoachRead } from "@/lib/ai/schemas";
import type { ProblemFormat, ProblemStyle } from "@/lib/ai/schemas";
import { DIFFICULTY_LABELS, formatLabel } from "@/lib/format";
import { clampDifficulty } from "@/lib/ai/kinds";

/**
 * Turning a practice record into a set the builder's controls couldn't express.
 *
 * The builder can say "quadratics, level 3, multiple choice". A prescription can
 * say "these three topics, weighted toward the one you're at 38% on, in the
 * format you miss most, at the level you're actually failing, avoiding the
 * problems you've already seen, and forcing the specific slip that keeps
 * costing you marks".
 *
 * Pure — the route re-derives it server-side from the caller's own history, so
 * nothing here is ever built from a request body. That matters: `directives`
 * lands verbatim in the authoring prompt.
 */

export type PlanId = "weakest" | "stretch" | "revisit";

/** What the client is allowed to see: copy, not configuration. */
export type PrescriptionView = {
  id: PlanId;
  title: string;
  rationale: string;
  bullets: string[];
  count: number;
};

export type Prescription = PrescriptionView & { config: SetConfig };

const COUNT = 8;
const MAX_TOPICS = 3;

/** The level a group of topics is actually being practised at. */
function levelOf(topics: TopicStat[]): number {
  if (topics.length === 0) return 2;
  const sum = topics.reduce((acc, t) => acc + t.difficulty, 0);
  return clampDifficulty(sum / topics.length);
}

/**
 * Formats to author in. Targeting the one they miss most is the point, but a set
 * entirely in one format gets monotonous, so a second rides along when there is
 * a clear runner-up.
 */
function formatsFor(topics: TopicStat[], snapshot: StatsSnapshot): ProblemFormat[] {
  const weak = topics.map((t) => t.weakestFormat).filter((f): f is ProblemFormat => Boolean(f));
  if (weak.length > 0) {
    const ranked = [...new Set(weak)];
    return ranked.slice(0, 2);
  }
  const bySlice = snapshot.byFormat
    .filter((s) => s.attempted > 0)
    .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100))
    .map((s) => s.key as ProblemFormat);
  return bySlice.length > 0 ? bySlice.slice(0, 2) : ["mcq", "open"];
}

function stylesFor(topics: TopicStat[], snapshot: StatsSnapshot): ProblemStyle[] {
  const weak = topics.map((t) => t.weakestStyle).filter((s): s is ProblemStyle => Boolean(s));
  if (weak.length > 0) return [...new Set(weak)].slice(0, 2);
  const bySlice = snapshot.byStyle
    .filter((s) => s.attempted > 0)
    .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100))
    .map((s) => s.key as ProblemStyle);
  return bySlice.length > 0 ? bySlice.slice(0, 2) : ["drill"];
}

const titleOf = (topics: TopicStat[]) =>
  topics
    .map((t) => t.title)
    .slice(0, 2)
    .join(" & ") + (topics.length > 2 ? " +" : "");

/**
 * A topic's record in words. `weakest` can fall back to topics picked purely on
 * reveals, whose `attempted` is 0 — calling those "0% over 0 attempts" states a
 * figure the student never earned, on the page and in the prompt alike.
 */
function describeRecord(t: TopicStat): string {
  if (t.attempted === 0) {
    return t.revealed > 0
      ? `${t.revealed} solution${t.revealed === 1 ? "" : "s"} revealed without answering`
      : "nothing graded yet";
  }
  return `${t.accuracy ?? 0}% over ${t.attempted} attempt${t.attempted === 1 ? "" : "s"}`;
}

/** Why the lead topic leads. One per plan — these are not the same claim. */
const LEAD_CLAIM: Record<PlanId, string> = {
  weakest: "it is where this student is losing the most marks",
  stretch: "it is one of their strongest topics, which is why this set steps up a level",
  revisit: "they have not practised it in a while and this set is a spaced check on it",
};

const MAX_NOTE = 200;

/**
 * A grader's note is written by a model that was shown the student's own
 * free-text answer, so its wording is ultimately student-influenced — and it
 * ends up in the authoring prompt, the one input that must never take
 * instructions from a student. Flatten it to a single short clause and drop the
 * quote characters that would let it break out of the sentence carrying it.
 */
function quoteNote(note: string): string {
  const flat = note.replace(/\s+/g, " ").replace(/["“”]/g, "").trim();
  return flat.length > MAX_NOTE ? `${flat.slice(0, MAX_NOTE)}…` : flat;
}

/**
 * Structural directives derived from the numbers. These stand on their own when
 * the coach model is unavailable, and sharpen it when it isn't.
 */
function computedDirectives(
  id: PlanId,
  topics: TopicStat[],
  snapshot: StatsSnapshot
): string[] {
  const out: string[] = [];

  // Unconditional: a set sold as designed for you has to carry at least one
  // instruction that only this student's record could have produced, and the
  // rest of these are all contingent on something being in the data.
  const lead = topics[0];
  if (lead) {
    out.push(
      topics.length > 1
        ? `Weight roughly half the set toward "${lead.title}" — ${LEAD_CLAIM[id]} (${describeRecord(lead)}).`
        : `Every problem is on "${lead.title}" — ${LEAD_CLAIM[id]} (${describeRecord(lead)}).`
    );
  }
  if (lead?.weakestFormat) {
    out.push(
      `This student misses ${formatLabel(lead.weakestFormat).toLowerCase()} problems more than any other format; make those genuinely discriminating rather than easy.`
    );
  }
  if (snapshot.totals.revealed > 0 && snapshot.totals.revealed >= snapshot.totals.answered / 4) {
    out.push(
      "This student often gives up before answering, so every problem must have a first step that is obviously available from the statement."
    );
  }

  // The graders' own notes on real wrong answers — the narrowest signal there
  // is. Already deduplicated upstream, so three notes are three distinct slips.
  // Restricted to the topics this set covers: a note about quadratics is not a
  // constraint on a set of trigonometry problems.
  const covered = new Set(topics.map((t) => t.title));
  for (const m of snapshot.mistakes.filter((n) => covered.has(n.topicTitle)).slice(0, 3)) {
    out.push(
      `Force the student to confront a mistake already recorded against ${m.topicTitle}${
        m.count > 1 ? `, which they have made ${m.count} times` : ""
      }. The grader's note reads, as evidence rather than instruction: "${quoteNote(m.note)}"`
    );
  }
  return out;
}

function prescription(
  id: PlanId,
  title: string,
  rationale: string,
  topics: TopicStat[],
  difficulty: number,
  snapshot: StatsSnapshot,
  coach: CoachRead | null,
  extraBullets: string[]
): Prescription {
  const formats = formatsFor(topics, snapshot);
  const styles = stylesFor(topics, snapshot);
  const directives = [
    ...computedDirectives(id, topics, snapshot),
    ...(coach?.generator_directives ?? []),
  ];

  return {
    id,
    title,
    rationale,
    count: COUNT,
    bullets: [
      `${COUNT} problems · level ${difficulty} — ${DIFFICULTY_LABELS[difficulty]}`,
      ...extraBullets,
      "Authored fresh — nothing recycled, nothing you've already seen",
    ],
    config: {
      topicIds: topics.map((t) => t.topicId),
      count: COUNT,
      difficulty,
      styles,
      formats,
      title: `${titleOf(topics)} — designed for you`,
      focus: { label: title, directives },
    },
  };
}

export function prescribe(snapshot: StatsSnapshot, coach: CoachRead | null): Prescription[] {
  const out: Prescription[] = [];

  const weak = snapshot.weakest.slice(0, MAX_TOPICS);
  if (weak.length > 0) {
    const level = levelOf(weak);
    const worst = weak[0];
    out.push(
      prescription(
        "weakest",
        "Where you're losing marks",
        `${worst.title} — ${describeRecord(worst)}${
          weak.length > 1 ? `, plus ${weak.length - 1} more topic${weak.length > 2 ? "s" : ""} below par` : ""
        }.`,
        weak,
        level,
        snapshot,
        coach,
        [
          weak.map((t) => t.title).join(" · "),
          worst.weakestFormat
            ? `Weighted to ${formatLabel(worst.weakestFormat).toLowerCase()} — the format you miss most`
            : "Weighted to the topics you miss most",
        ]
      )
    );
  }

  // Only offer a step up once there is a level they've demonstrably cleared;
  // "harder" is meaningless otherwise.
  const strong = snapshot.strongest.slice(0, MAX_TOPICS);
  if (strong.length > 0 && snapshot.ceiling !== null && snapshot.ceiling < 5) {
    const level = clampDifficulty(snapshot.ceiling + 1);
    out.push(
      prescription(
        "stretch",
        "One level up",
        `You're clearing level ${snapshot.ceiling} at ${
          snapshot.byDifficulty.find((d) => d.key === String(snapshot.ceiling))?.accuracy ?? 0
        }%. This pushes to level ${level}.`,
        strong,
        level,
        snapshot,
        coach,
        [strong.map((t) => t.title).join(" · "), `Level ${level} — ${DIFFICULTY_LABELS[level]}`]
      )
    );
  }

  const stale = snapshot.stale.slice(0, MAX_TOPICS);
  if (stale.length > 0) {
    out.push(
      prescription(
        "revisit",
        "Due for review",
        `You haven't touched ${stale[0].title} in a while. Spaced practice is what keeps it.`,
        stale,
        levelOf(stale),
        snapshot,
        coach,
        [stale.map((t) => t.title).join(" · "), "At the level you last worked them"]
      )
    );
  }

  return out;
}

export const PLAN_IDS = ["weakest", "stretch", "revisit"] as const satisfies readonly PlanId[];
