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

type TopicRow = {
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
export async function runCensus(
  db: SupabaseClient,
  opts: { course?: string; target: number }
): Promise<void> {
  const { data, error } = await db.from("topics").select(TOPIC_COLUMNS);
  if (error) throw new Error(`topic lookup failed: ${error.message}`);
  const all = (data as unknown as TopicRow[]).filter(
    (t) => !opts.course || t.units?.courses?.title === opts.course
  );
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
  const infos = topics.map(topicInfo);
  const ids = topics.map((t) => t.id);

  // Everything already in the pool for these topics at this level goes in as an
  // avoid list, which is the whole reason this step talks to the database at
  // all. Authoring blind is how you spend an afternoon writing the pool's
  // twelve most common problems for the second time.
  const { data: existing, error } = await db
    .from("problems")
    .select("content")
    .in("topic_id", ids)
    .eq("difficulty", opts.difficulty)
    .eq("status", "active")
    .limit(120);
  if (error) throw new Error(`pool read failed: ${error.message}`);
  const avoid = (existing ?? [])
    .map((r) => (r.content as { statement_latex?: string })?.statement_latex ?? "")
    .filter(Boolean);

  const mix = new Map(
    [...splitAcrossKinds(opts.count, opts.formats)].filter(([, wanted]) => wanted > 0)
  );
  const request = {
    topics: infos,
    count: opts.count,
    difficulty: opts.difficulty,
    styles: opts.styles,
    formats: opts.formats,
    avoid,
  };

  const plan: SeedPlan = {
    difficulty: opts.difficulty,
    styles: opts.styles,
    formats: opts.formats,
    count: opts.count,
    topics: topics.map((t) => ({ id: t.id, slug: t.slug, title: t.title })),
  };
  writeJson(opts.dir, FILES.plan, plan);
  writeJson(opts.dir, FILES.problemSchema, jsonSchemaFor(MixedBatchSchema));

  const brief = `# Authoring brief

Write ${opts.count} problems into \`${opts.dir}/${FILES.authored}\`, then run:

    npm run seed -- solve

You are the author here. Everything below — the rules, the topics, the format
mix, the avoid list — is what the live pipeline sends its own authoring model,
assembled by the same code. Follow it as written.

Two things this brief does not say and you should not infer: nothing here is
addressed to a student, and nothing here asks for problems in the source
material's wording. Write originals.

Pool depth for these topics at difficulty ${opts.difficulty}: ${avoid.length} problem${
    avoid.length === 1 ? "" : "s"
  } already active${avoid.length >= 120 ? " (showing the first 120)" : ""}.

## Rules

${fence(GENERATOR_SYSTEM_PROMPT)}

## Request

${fence(buildUserMessage(request, mix))}

## Output

Write \`${opts.dir}/${FILES.authored}\` as one JSON object:

    { "problems": [ /* ${opts.count} problems */ ] }

Every problem must validate against \`${opts.dir}/${FILES.problemSchema}\`, which is
the exact schema the pipeline validates model output against. Two fields in it
are worth reading twice, because they are the ones that get silently dropped:

- \`format\` must match the shape you actually wrote. The schema is a union
  discriminated on it, so a problem labelled \`mcq\` that carries \`blanks\` does
  not fail loudly — it fails to parse, and it is discarded.
- \`topic_index\` is the bracketed number from the Topics list above, for the
  topic the problem actually tests. It decides who gets served this problem
  forever.
`;

  const path = writeFile(opts.dir, FILES.authoringBrief, brief);
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
