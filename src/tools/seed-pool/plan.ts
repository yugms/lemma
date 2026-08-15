/**
 * Step one: work out what the pool is short of, and write the brief that asks
 * for it.
 *
 * The brief is assembled from `GENERATOR_SYSTEM_PROMPT` and `buildUserMessage`
 * rather than from prose written here. Those are what the live pipeline authors
 * against, and a second specification that drifted from them would seed the
 * pool with problems subtly unlike everything else in it — a difference nobody
 * would attribute to this tool months later.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildUserMessage, splitAcrossKinds, type TopicInfo } from "@/lib/ai/generate";
import type { GenerationKind } from "@/lib/ai/kinds";
import { GENERATOR_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { jsonSchemaFor } from "@/lib/ai/provider";
import { MixedBatchSchema, type ProblemFormat, type ProblemStyle } from "@/lib/ai/schemas";
import {
  fence,
  FILES,
  selectAll,
  writeFile,
  writeJson,
  type SeedPlan,
} from "@/tools/seed-pool/shared";

export type TopicRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  units: { title: string; courses: { title: string } | null } | null;
};

const TOPIC_COLUMNS = "id, slug, title, description, units(title, courses(title))";

/**
 * Resolve slugs to topics, in the order they were asked for.
 *
 * The order is the contract: `topic_index` on an authored problem is an offset
 * into the numbered list the brief printed, so whatever order comes back has to
 * be the order that gets recorded in `plan.json` and shown in the brief. Sorting
 * it anywhere in between re-tags every problem.
 */
export async function loadTopics(db: SupabaseClient, slugs: string[]): Promise<TopicRow[]> {
  const { data, error } = await db.from("topics").select(TOPIC_COLUMNS).in("slug", slugs);
  if (error) throw new Error(`topic lookup failed: ${error.message}`);
  const bySlug = new Map((data as unknown as TopicRow[]).map((t) => [t.slug, t]));
  const missing = slugs.filter((s) => !bySlug.has(s));
  if (missing.length > 0) {
    throw new Error(
      `no topic with slug: ${missing.join(", ")} — run \`npm run seed -- census\` for the catalog`
    );
  }
  return slugs.map((s) => bySlug.get(s)!);
}

export function topicInfo(t: TopicRow): TopicInfo {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    unit_title: t.units?.title,
    course_title: t.units?.courses?.title,
  };
}

export type PoolRow = { topic_id: string; difficulty: number; style: string; format: string };

/** Every problem a build could actually reuse: `active` only, which is what the pool query filters on. */
export async function loadPool(db: SupabaseClient, topicIds?: string[]): Promise<PoolRow[]> {
  return selectAll<PoolRow>((from, to) => {
    let q = db
      .from("problems")
      .select("topic_id, difficulty, style, format")
      .eq("status", "active");
    if (topicIds) q = q.in("topic_id", topicIds);
    return q.range(from, to);
  });
}

const tally = <T>(rows: T[], key: (r: T) => string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return counts;
};

/**
 * Print what the pool holds, so the next thing authored is the thing that was
 * missing. Depth per (topic, difficulty) is the number that matters: a build
 * takes half its slots from the pool ordered by `times_served`, so a cell with
 * three problems in it serves the same three to everyone.
 */
export async function loadCatalog(db: SupabaseClient, course?: string): Promise<TopicRow[]> {
  // Paged for the same reason `loadPool` is: PostgREST caps a response at 1000
  // rows and says nothing about having done so. A truncated catalog doesn't
  // fail, it just quietly stops offering the topics past the cut — `census`
  // omits them and `auto` never picks a cell in them, which reads as those
  // topics simply being well stocked. The course filter stays in memory
  // because the title lives two joins away.
  const rows = await selectAll<TopicRow>(async (from, to) => {
    const { data, error } = await db.from("topics").select(TOPIC_COLUMNS).range(from, to);
    // The same cast `loadTopics` makes: PostgREST types a nested join as an array.
    return { data: data as unknown as TopicRow[] | null, error };
  });
  return rows.filter((t) => !course || t.units?.courses?.title === course);
}

export async function runCensus(
  db: SupabaseClient,
  opts: { course?: string; target: number }
): Promise<void> {
  const all = await loadCatalog(db, opts.course);
  if (all.length === 0) {
    console.log(opts.course ? `No topics in course "${opts.course}".` : "No topics in the catalog.");
    return;
  }

  const pool = await loadPool(
    db,
    opts.course ? all.map((t) => t.id) : undefined
  );
  const byCell = tally(pool, (r) => `${r.topic_id}|${r.difficulty}`);
  const byTopic = tally(pool, (r) => r.topic_id);

  const width = Math.max(...all.map((t) => t.slug.length), 4);
  console.log(`Active pool problems per topic, by difficulty. Target depth ${opts.target}.\n`);
  console.log(`${"slug".padEnd(width)}  ${[1, 2, 3, 4, 5].map((d) => `d${d}`.padStart(5)).join("")}   total  course / unit`);
  const ordered = [...all].sort(
    (a, b) => (byTopic.get(a.id) ?? 0) - (byTopic.get(b.id) ?? 0) || a.slug.localeCompare(b.slug)
  );
  for (const t of ordered) {
    const cells = [1, 2, 3, 4, 5]
      .map((d) => {
        const n = byCell.get(`${t.id}|${d}`) ?? 0;
        // A bare 0 and a 0 that is fine because nobody practises at that level
        // look identical, so mark the shortfall rather than the count.
        return (n < opts.target ? `${n}*` : `${n}`).padStart(5);
      })
      .join("");
    const where = [t.units?.courses?.title, t.units?.title].filter(Boolean).join(" / ");
    console.log(`${t.slug.padEnd(width)}  ${cells}  ${String(byTopic.get(t.id) ?? 0).padStart(6)}  ${where}`);
  }

  console.log(`\n* = under the target. Styles: ${describe(tally(pool, (r) => r.style))}`);
  console.log(`Formats: ${describe(tally(pool, (r) => r.format))}`);
  console.log(
    `\nTemplates already cover \`drill\` for free, so the cheapest cells to leave alone are drill ones.`
  );
}

const describe = (counts: Map<string, number>) =>
  [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ") || "none";

const AVOID_LIMIT = 120;

/**
 * What the pool already holds for these topics at this level, as statements.
 *
 * This is the whole reason the planning step talks to the database. Authoring
 * blind is how you spend an afternoon writing the pool's twelve most common
 * problems for the second time — and `insertProblems` upserts on the content
 * hash, so the second copy doesn't even announce itself.
 */
export async function avoidList(
  db: SupabaseClient,
  topicIds: string[],
  difficulty: number
): Promise<string[]> {
  const { data, error } = await db
    .from("problems")
    .select("content")
    .in("topic_id", topicIds)
    .eq("difficulty", difficulty)
    .eq("status", "active")
    .limit(AVOID_LIMIT);
  if (error) throw new Error(`pool read failed: ${error.message}`);
  return (data ?? [])
    .map((r) => (r.content as { statement_latex?: string })?.statement_latex ?? "")
    .filter(Boolean);
}

export type AuthoringSetup = {
  topics: TopicRow[];
  difficulty: number;
  count: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  avoid: string[];
  /** Where the three files go. */
  dir: string;
  /**
   * The command whoever authors this should run next, or `null` when a driver
   * is running it instead.
   *
   * It also decides how the brief names its own files, because the two go
   * together: `plan` is run from the repo root with its files under `.seed`, so
   * they have to be qualified, while `auto` runs the author *inside* the
   * directory, where a qualified path would write a second copy one level down.
   */
  next: string | null;
};

/**
 * Write the brief, the plan and the schema that one authoring batch needs.
 *
 * Shared by `plan` and `auto` rather than reimplemented, on the same argument
 * as everything else in this tool: the brief is assembled from the live
 * pipeline's own prompt and request builder, and a driver that assembled its
 * own would be seeding the pool against a specification that drifts.
 */
export function writeAuthoringBrief(s: AuthoringSetup): {
  plan: SeedPlan;
  mix: Map<GenerationKind, number>;
  path: string;
  /** The same text, so a driver can hand it to a subprocess without a second read. */
  brief: string;
} {
  const at = (name: string) => (s.next === null ? name : `${s.dir}/${name}`);
  const mix = new Map([...splitAcrossKinds(s.count, s.formats)].filter(([, wanted]) => wanted > 0));
  const request = {
    topics: s.topics.map(topicInfo),
    count: s.count,
    difficulty: s.difficulty,
    styles: s.styles,
    formats: s.formats,
    avoid: s.avoid,
  };

  const plan: SeedPlan = {
    difficulty: s.difficulty,
    styles: s.styles,
    formats: s.formats,
    count: s.count,
    topics: s.topics.map((t) => ({ id: t.id, slug: t.slug, title: t.title })),
  };
  writeJson(s.dir, FILES.plan, plan);
  writeJson(s.dir, FILES.problemSchema, jsonSchemaFor(MixedBatchSchema));

  const brief = `# Authoring brief

${
  s.next === null
    ? `Write ${s.count} problems into \`${at(FILES.authored)}\`.`
    : `Write ${s.count} problems into \`${at(FILES.authored)}\`, then run:\n\n    ${s.next}`
}

You are the author here. Everything below — the rules, the topics, the format
mix, the avoid list — is what the live pipeline sends its own authoring model,
assembled by the same code. Follow it as written.

Two things this brief does not say and you should not infer: nothing here is
addressed to a student, and nothing here asks for problems in the source
material's wording. Write originals.

Pool depth for these topics at difficulty ${s.difficulty}: ${s.avoid.length} problem${
    s.avoid.length === 1 ? "" : "s"
  } already active${s.avoid.length >= AVOID_LIMIT ? ` (showing the first ${AVOID_LIMIT})` : ""}.

## Rules

${fence(GENERATOR_SYSTEM_PROMPT)}

## Request

${fence(buildUserMessage(request, mix))}

## Output

Write \`${at(FILES.authored)}\` as one JSON object:

    { "problems": [ /* ${s.count} problems */ ] }

Every problem must validate against \`${at(FILES.problemSchema)}\`, which is
the exact schema the pipeline validates model output against. Two fields in it
are worth reading twice, because they are the ones that get silently dropped:

- \`format\` must match the shape you actually wrote. The schema is a union
  discriminated on it, so a problem labelled \`mcq\` that carries \`blanks\` does
  not fail loudly — it fails to parse, and it is discarded.
- \`topic_index\` is the bracketed number from the Topics list above, for the
  topic the problem actually tests. It decides who gets served this problem
  forever.
`;

  return { plan, mix, brief, path: writeFile(s.dir, FILES.authoringBrief, brief) };
}

export type PlanOptions = {
  slugs: string[];
  difficulty: number;
  count: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  dir: string;
};

export async function runPlan(db: SupabaseClient, opts: PlanOptions): Promise<void> {
  const topics = await loadTopics(db, opts.slugs);
  const avoid = await avoidList(
    db,
    topics.map((t) => t.id),
    opts.difficulty
  );
  const { mix, path } = writeAuthoringBrief({
    ...opts,
    topics,
    avoid,
    next: "npm run seed -- solve",
  });

  console.log(`Wrote ${path}`);
  console.log(
    `  ${opts.count} problems, difficulty ${opts.difficulty}, ${topics.length} topic${
      topics.length === 1 ? "" : "s"
    }: ${topics.map((t) => t.slug).join(", ")}`
  );
  console.log(`  mix: ${[...mix].map(([k, n]) => `${n}x ${k}`).join(", ")}`);
  console.log(`  avoid list: ${avoid.length} statement${avoid.length === 1 ? "" : "s"}`);
  console.log(`\nNext: author ${opts.dir}/${FILES.authored}, then \`npm run seed -- solve\`.`);
}
