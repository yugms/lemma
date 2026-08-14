import { createServiceClient } from "@/lib/supabase/service";
import { DIFFICULTY_LABELS, formatLabel, STYLE_LABELS } from "@/lib/format";
import {
  ATTEMPT_MODES,
  MODE_LABELS,
  staleBefore,
  type AttemptMode,
} from "@/lib/attempt-state";
import type { ProblemFormat, ProblemStyle } from "@/lib/ai/schemas";

/**
 * Practice analytics, derived from `attempts` the same way `progress.ts` derives
 * set state — no stored aggregates, nothing the client can fabricate.
 *
 * Split into a pure `aggregate()` and a thin loader so the arithmetic (streaks,
 * smoothing, ranking) is testable offline. Every "now" the math needs is passed
 * in rather than read, which also keeps this usable from a Server Component
 * without tripping `react-hooks/purity`.
 *
 * Counting rules match `loadUserStats` deliberately, so the home page tiles and
 * this page can never disagree:
 *   - every graded submission counts, repeats included (`totals.problems`
 *     reports distinct problems separately);
 *   - reveals are excluded from accuracy but counted as activity, because a
 *     student who asks for the solution shouldn't be scored as if they guessed.
 */

export type StatsScope = "all" | "session";

/**
 * Inclusive lower bound / upper bound. Null means unbounded.
 *
 * `empty` is not the same as unbounded: it means "match nothing on purpose",
 * which is what scoping to a session that doesn't exist has to do.
 */
export type StatsWindow = { since: string | null; until: string | null; empty?: boolean };

export type AttemptRow = {
  isCorrect: boolean | null;
  createdAt: string;
  timeMs: number | null;
  /** `ai_feedback.what_went_wrong_latex` — the grader's read on this mistake. */
  mistake: string | null;
  /**
   * The student came back and got it right on a second attempt. Never counted
   * as correct — the first answer is what scores the set — but it is the
   * difference between "doesn't know this" and "slipped", which is exactly what
   * a weakness ranking should not confuse.
   */
  recovered?: boolean;
  /** How this attempt was taken: practice, a quiz, or a flashcard rep. */
  mode: AttemptMode;
  problemId: string;
  difficulty: number;
  style: ProblemStyle;
  format: ProblemFormat;
  topicId: string;
  topicSlug: string;
  topicTitle: string;
  unitTitle: string;
  courseTitle: string;
};

export type SliceStat = {
  key: string;
  label: string;
  attempted: number;
  correct: number;
  accuracy: number | null;
};

export type TopicStat = {
  topicId: string;
  slug: string;
  title: string;
  unitTitle: string;
  courseTitle: string;
  attempted: number;
  correct: number;
  revealed: number;
  /** Missed first, then got right on the retry. */
  recovered: number;
  accuracy: number | null;
  /** The level they've mostly been practising this at. */
  difficulty: number;
  weakestFormat: ProblemFormat | null;
  weakestStyle: ProblemStyle | null;
  lastAt: string | null;
};

/**
 * A distinct mistake, with how often it has happened. Deduplicated because the
 * same slip repeated nine times is one thing to work on, not nine — and because
 * nine copies of one string would otherwise crowd out every other signal in the
 * coach prompt. The count is the useful part: it's what makes it "recurring".
 */
export type MistakeNote = { topicTitle: string; note: string; at: string; count: number };

export type StatsSnapshot = {
  totals: {
    answered: number;
    correct: number;
    revealed: number;
    /** Wrong first, right on the second attempt. */
    recovered: number;
    accuracy: number | null;
    medianTimeMs: number | null;
    /** Distinct problems touched, as opposed to submissions. */
    problems: number;
  };
  streak: { current: number; best: number };
  activity: { date: string; answered: number; correct: number; revealed: number }[];
  byTopic: TopicStat[];
  /** Practice vs quiz vs flashcards — recall under different conditions. */
  byMode: SliceStat[];
  byFormat: SliceStat[];
  byStyle: SliceStat[];
  byDifficulty: SliceStat[];
  /** Ranked worst-first. What the page tells you to work on. */
  weakest: TopicStat[];
  strongest: TopicStat[];
  /** Practised before, untouched for a while — due for review. */
  stale: TopicStat[];
  /** Highest difficulty cleared at >= 70% over >= 4 graded attempts. */
  ceiling: number | null;
  mistakes: MistakeNote[];
  lastAttemptAt: string | null;
};

const ACTIVITY_DAYS = 30;
/** Below this a topic's accuracy is noise, not a weakness. */
const MIN_FOR_RANKING = 3;
const MAX_MISTAKES = 12;

const dayKey = (iso: string) => {
  const d = new Date(iso);
  // Local to the server, matching `loadUserStats`. Consistency between the two
  // pages matters more here than per-student timezone accuracy.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const pct = (correct: number, attempted: number) =>
  attempted > 0 ? Math.round((correct / attempted) * 100) : null;

/**
 * Laplace-smoothed accuracy. Ranking on raw percentage lets a single unlucky
 * attempt (0/1 = 0%) outrank a topic genuinely missed 17 times out of 20.
 */
const smoothed = (correct: number, attempted: number) =>
  (correct + 1) / (attempted + 2);

type Bucket = { attempted: number; correct: number };
const bump = (map: Map<string, Bucket>, key: string, graded: boolean, correct: boolean) => {
  const b = map.get(key) ?? { attempted: 0, correct: 0 };
  if (graded) {
    b.attempted++;
    if (correct) b.correct++;
  }
  map.set(key, b);
};

function slices<K extends string>(
  map: Map<string, Bucket>,
  label: (key: K) => string
): SliceStat[] {
  return [...map.entries()]
    .map(([key, b]) => ({
      key,
      label: label(key as K),
      attempted: b.attempted,
      correct: b.correct,
      accuracy: pct(b.correct, b.attempted),
    }))
    .filter((s) => s.attempted > 0)
    .sort((a, b) => b.attempted - a.attempted);
}

/** Pure. `now` is injected so streak and staleness stay testable. */
export function aggregate(rows: AttemptRow[], now: number = 0): StatsSnapshot {
  const empty: StatsSnapshot = {
    totals: {
      answered: 0,
      correct: 0,
      revealed: 0,
      recovered: 0,
      accuracy: null,
      medianTimeMs: null,
      problems: 0,
    },
    streak: { current: 0, best: 0 },
    activity: [],
    byTopic: [],
    byMode: [],
    byFormat: [],
    byStyle: [],
    byDifficulty: [],
    weakest: [],
    strongest: [],
    stale: [],
    ceiling: null,
    mistakes: [],
    lastAttemptAt: null,
  };
  if (rows.length === 0) return empty;

  let answered = 0;
  let correct = 0;
  let revealed = 0;
  let recovered = 0;
  const times: number[] = [];
  const problems = new Set<string>();
  const days = new Map<string, { answered: number; correct: number; revealed: number }>();

  const modes = new Map<string, Bucket>();
  const formats = new Map<string, Bucket>();
  const styles = new Map<string, Bucket>();
  const difficulties = new Map<string, Bucket>();

  type TopicAcc = {
    meta: Pick<TopicStat, "topicId" | "slug" | "title" | "unitTitle" | "courseTitle">;
    attempted: number;
    correct: number;
    revealed: number;
    recovered: number;
    lastAt: string;
    difficulties: number[];
    formats: Map<string, Bucket>;
    styles: Map<string, Bucket>;
  };
  const topics = new Map<string, TopicAcc>();
  const mistakes = new Map<string, MistakeNote>();

  for (const r of rows) {
    const graded = r.isCorrect !== null;
    const isCorrect = r.isCorrect === true;

    problems.add(r.problemId);
    if (graded) {
      answered++;
      if (isCorrect) correct++;
      if (r.timeMs !== null && r.timeMs > 0) times.push(r.timeMs);
    } else {
      revealed++;
    }
    if (r.recovered) recovered++;

    const key = dayKey(r.createdAt);
    const day = days.get(key) ?? { answered: 0, correct: 0, revealed: 0 };
    if (graded) {
      day.answered++;
      if (isCorrect) day.correct++;
    } else {
      day.revealed++;
    }
    days.set(key, day);

    bump(modes, r.mode, graded, isCorrect);
    bump(formats, r.format, graded, isCorrect);
    bump(styles, r.style, graded, isCorrect);
    bump(difficulties, String(r.difficulty), graded, isCorrect);

    let t = topics.get(r.topicId);
    if (!t) {
      t = {
        meta: {
          topicId: r.topicId,
          slug: r.topicSlug,
          title: r.topicTitle,
          unitTitle: r.unitTitle,
          courseTitle: r.courseTitle,
        },
        attempted: 0,
        correct: 0,
        revealed: 0,
        recovered: 0,
        lastAt: r.createdAt,
        difficulties: [],
        formats: new Map(),
        styles: new Map(),
      };
      topics.set(r.topicId, t);
    }
    if (graded) {
      t.attempted++;
      if (isCorrect) t.correct++;
    } else {
      t.revealed++;
    }
    if (r.recovered) t.recovered++;
    t.difficulties.push(r.difficulty);
    if (r.createdAt > t.lastAt) t.lastAt = r.createdAt;
    bump(t.formats, r.format, graded, isCorrect);
    bump(t.styles, r.style, graded, isCorrect);

    if (r.mistake && r.isCorrect === false) {
      const noteKey = `${r.topicId}|${r.mistake}`;
      const seen = mistakes.get(noteKey);
      if (seen) {
        seen.count++;
        if (r.createdAt > seen.at) seen.at = r.createdAt;
      } else {
        mistakes.set(noteKey, {
          topicTitle: r.topicTitle,
          note: r.mistake,
          at: r.createdAt,
          count: 1,
        });
      }
    }
  }

  // Weakest slice within a topic: only meaningful once there's something to
  // compare, so a topic practised in one format reports none.
  const weakestOf = <K extends string>(map: Map<string, Bucket>): K | null => {
    const scored = [...map.entries()].filter(([, b]) => b.attempted > 0);
    if (scored.length < 2) return null;
    scored.sort((a, b) => smoothed(a[1].correct, a[1].attempted) - smoothed(b[1].correct, b[1].attempted));
    return scored[0][0] as K;
  };

  const byTopic: TopicStat[] = [...topics.values()]
    .map((t) => ({
      ...t.meta,
      attempted: t.attempted,
      correct: t.correct,
      revealed: t.revealed,
      recovered: t.recovered,
      accuracy: pct(t.correct, t.attempted),
      difficulty: mode(t.difficulties),
      weakestFormat: weakestOf<ProblemFormat>(t.formats),
      weakestStyle: weakestOf<ProblemStyle>(t.styles),
      lastAt: t.lastAt,
    }))
    .sort((a, b) => b.attempted + b.revealed - (a.attempted + a.revealed));

  const rankable = byTopic.filter((t) => t.attempted >= MIN_FOR_RANKING);
  const worstFirst = [...rankable].sort(
    (a, b) => smoothed(a.correct, a.attempted) - smoothed(b.correct, b.attempted)
  );

  // Nothing has enough graded history yet, but reveals are their own signal —
  // a problem you gave up on is a problem you couldn't do.
  const weakest =
    worstFirst.length > 0
      ? worstFirst.filter((t) => (t.accuracy ?? 100) < 85).slice(0, 3)
      : byTopic.filter((t) => t.revealed > 0).slice(0, 3);

  const strongest = [...rankable]
    .sort((a, b) => smoothed(b.correct, b.attempted) - smoothed(a.correct, a.attempted))
    .filter((t) => (t.accuracy ?? 0) >= 85)
    .slice(0, 3);

  const cutoff = staleBefore(now);
  const stale = byTopic
    .filter((t) => t.lastAt !== null && new Date(t.lastAt).getTime() < cutoff)
    .sort((a, b) => (a.lastAt ?? "").localeCompare(b.lastAt ?? ""))
    .slice(0, 3);

  const byDifficulty = slices<string>(difficulties, (k) => `Level ${k} — ${DIFFICULTY_LABELS[Number(k)] ?? ""}`)
    .sort((a, b) => Number(a.key) - Number(b.key));

  // The level they've demonstrably got, which is what a "stretch" set builds on.
  let ceiling: number | null = null;
  for (const d of byDifficulty) {
    if (d.attempted >= 4 && (d.accuracy ?? 0) >= 70) {
      ceiling = Math.max(ceiling ?? 0, Number(d.key));
    }
  }

  return {
    totals: {
      answered,
      correct,
      revealed,
      recovered,
      accuracy: pct(correct, answered),
      medianTimeMs: median(times),
      problems: problems.size,
    },
    streak: streakOf(days, now),
    activity: denseActivity(days, now),
    byTopic,
    byMode: slices<AttemptMode>(modes, (k) => MODE_LABELS[k] ?? k),
    byFormat: slices<ProblemFormat>(formats, (k) => formatLabel(k)),
    byStyle: slices<ProblemStyle>(styles, (k) => STYLE_LABELS[k]),
    byDifficulty,
    weakest,
    strongest,
    stale,
    ceiling,
    // Most frequent first, then most recent — a slip made nine times outranks
    // one made yesterday.
    mistakes: [...mistakes.values()]
      .sort((a, b) => b.count - a.count || b.at.localeCompare(a.at))
      .slice(0, MAX_MISTAKES),
    lastAttemptAt: rows[rows.length - 1]?.createdAt ?? null,
  };
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0] ?? 1;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount || (c === bestCount && v > best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/**
 * Consecutive days of practice. The current streak may end today or yesterday —
 * a student who hasn't practised yet today hasn't broken anything.
 */
function streakOf(days: Map<string, unknown>, now: number): { current: number; best: number } {
  if (days.size === 0) return { current: 0, best: 0 };
  const sorted = [...days.keys()].sort();

  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round(
      (Date.parse(`${sorted[i]}T00:00:00`) - Date.parse(`${sorted[i - 1]}T00:00:00`)) / 86_400_000
    );
    run = gap === 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const today = new Date(now);
  const todayKey = dayKey(today.toISOString());
  const yesterdayKey = dayKey(new Date(now - 86_400_000).toISOString());
  const last = sorted[sorted.length - 1];

  let current = 0;
  if (last === todayKey || last === yesterdayKey) {
    current = 1;
    for (let i = sorted.length - 1; i > 0; i--) {
      const gap = Math.round(
        (Date.parse(`${sorted[i]}T00:00:00`) - Date.parse(`${sorted[i - 1]}T00:00:00`)) / 86_400_000
      );
      if (gap !== 1) break;
      current++;
    }
  }
  return { current, best };
}

/** Every day in the window, including the empty ones — a gap is information. */
function denseActivity(
  days: Map<string, { answered: number; correct: number; revealed: number }>,
  now: number
): StatsSnapshot["activity"] {
  const out: StatsSnapshot["activity"] = [];
  for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
    const date = dayKey(new Date(now - i * 86_400_000).toISOString());
    const d = days.get(date);
    out.push({
      date,
      answered: d?.answered ?? 0,
      correct: d?.correct ?? 0,
      revealed: d?.revealed ?? 0,
    });
  }
  return out;
}

/**
 * The joined shape PostgREST returns. Embedded to-one relations come back as an
 * object, but the generated types model them loosely, hence the cast at the
 * call site.
 */
type JoinedRow = {
  is_correct: boolean | null;
  created_at: string;
  time_ms: number | null;
  ai_feedback: { what_went_wrong_latex?: string | null } | null;
  mode: string;
  problem_id: string;
  problems: {
    difficulty: number;
    style: ProblemStyle;
    format: ProblemFormat;
    topics: {
      id: string;
      slug: string;
      title: string;
      units: { title: string; courses: { title: string } | null } | null;
    } | null;
  } | null;
};

/** Cap chosen well above any realistic student; see the ordering note below. */
const ROW_LIMIT = 5000;

export async function loadStatsSnapshot(
  userId: string,
  window: StatsWindow = { since: null, until: null }
): Promise<StatsSnapshot> {
  if (window.empty) return aggregate([], Date.now());

  const db = createServiceClient();
  const base = () => {
    let q = db.from("attempts").select(
      "is_correct, created_at, time_ms, ai_feedback, mode, problem_id, problems!inner(difficulty, style, format, topics!inner(id, slug, title, units!inner(title, courses!inner(title))))"
    );
    q = q.eq("user_id", userId);
    if (window.since) q = q.gte("created_at", window.since);
    if (window.until) q = q.lte("created_at", window.until);
    return q;
  };

  // Newest first, then reversed below: if the cap ever bites it has to drop the
  // oldest history, not an arbitrary slice.
  //
  // Only first attempts feed the statistics — a retry must not move accuracy.
  // The retries are read separately, purely to mark which misses were later
  // put right, which is a different fact about the same problem.
  // The retries query carries the same window and the same ordering as the
  // first-attempt one: scoped to a session, "recovered" has to mean a recovery
  // that happened in it, and an unordered cap would drop an arbitrary slice
  // rather than the oldest rows.
  let retryQuery = db
    .from("attempts")
    .select("problem_id, created_at")
    .eq("user_id", userId)
    .eq("attempt_no", 2)
    .eq("is_correct", true);
  if (window.since) retryQuery = retryQuery.gte("created_at", window.since);
  if (window.until) retryQuery = retryQuery.lte("created_at", window.until);

  const [{ data }, { data: retries }] = await Promise.all([
    base().eq("attempt_no", 1).order("created_at", { ascending: false }).limit(ROW_LIMIT),
    retryQuery.order("created_at", { ascending: false }).limit(ROW_LIMIT),
  ]);

  const recoveredIds = new Set(
    ((retries ?? []) as { problem_id: string }[]).map((r) => r.problem_id)
  );

  const rows = ((data ?? []) as unknown as JoinedRow[])
    .filter((r) => r.problems?.topics)
    .map<AttemptRow>((r) => ({
      isCorrect: r.is_correct,
      createdAt: r.created_at,
      timeMs: r.time_ms,
      mistake: r.ai_feedback?.what_went_wrong_latex?.trim() || null,
      recovered: r.is_correct === false && recoveredIds.has(r.problem_id),
      // Rows predate the column meaning anything; they were all practice.
      mode: (ATTEMPT_MODES as readonly string[]).includes(r.mode)
        ? (r.mode as AttemptMode)
        : "practice",
      problemId: r.problem_id,
      difficulty: r.problems!.difficulty,
      style: r.problems!.style,
      format: r.problems!.format,
      topicId: r.problems!.topics!.id,
      topicSlug: r.problems!.topics!.slug,
      topicTitle: r.problems!.topics!.title,
      unitTitle: r.problems!.topics!.units?.title ?? "",
      courseTitle: r.problems!.topics!.units?.courses?.title ?? "",
    }))
    .reverse();

  return aggregate(rows, Date.now());
}

/** Resolve `?scope=` into the window the loader wants. */
export function windowFor(
  scope: StatsScope,
  session: { startedAt: string; endedAt: string | null } | null
): StatsWindow {
  if (scope === "all") return { since: null, until: null };
  // Scoping to a session that was never started must show nothing. Falling back
  // to unbounded would put a lifetime's numbers under a "this session" heading,
  // which is worse than an empty page — it's a wrong one.
  if (!session) return { since: null, until: null, empty: true };
  return { since: session.startedAt, until: session.endedAt };
}
