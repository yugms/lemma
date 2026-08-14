/**
 * Seed the shared problem pool by hand, offline.
 *
 * Why this exists: a build fills up to `POOL_FRACTION` of every non-bespoke set
 * from verified `problems` rows, and those slots cost nothing — no model call,
 * no request against a daily quota. Today the pool only grows as a side effect
 * of builds that already paid for it. This lets it be stocked deliberately,
 * with the authoring and the solving done by whoever runs the tool rather than
 * by the provider.
 *
 * It is three steps with a file between each, because the expensive step is a
 * person reading one file and writing another:
 *
 *   plan   -> reads the pool, writes an authoring brief
 *   solve  -> reads the authored problems, writes their statements alone
 *   ingest -> judges the solutions against the keys, writes what survives
 *
 * `bespoke()` builds — a focus set or a material set — skip pool reuse
 * entirely, so nothing seeded here reaches them. This makes ordinary builds
 * cheaper; it does not make targeted ones cheaper.
 */
import { parseArgs } from "node:util";
import { PROBLEM_FORMATS, PROBLEM_STYLES } from "@/lib/ai/kinds";
import { createServiceClient } from "@/lib/supabase/service";
import { runCensus, runPlan } from "@/tools/seed-pool/plan";
import { runIngest } from "@/tools/seed-pool/ingest";
import { runSolve } from "@/tools/seed-pool/solve";
import { DEFAULT_DIR, parseEnumList, splitList, workspace } from "@/tools/seed-pool/shared";

const USAGE = `Seed the shared problem pool offline.

  npm run seed -- census [--course "Algebra 1"] [--target 20]
      What the pool already holds, per topic and difficulty. Start here.

  npm run seed -- plan --topics <slug,slug> [options]
      Write an authoring brief for the problems you want to add.
      --difficulty 1-5        (default 2)
      --count N               how many to author (default 12, max 60)
      --styles  <list>        of ${PROBLEM_STYLES.join(", ")} (default drill)
      --formats <list>        of ${PROBLEM_FORMATS.join(", ")} (default mcq,open)

  npm run seed -- solve
      Write the solving brief: statements only, no answers. Needs no database.

  npm run seed -- ingest [--dry-run] [--equivalence defer|ai]
      Judge the solutions and write what passes into the pool as \`active\`.

  Common: --dir <path>        workspace (default ${DEFAULT_DIR})

Templates already serve \`drill\` for free, so the pool slots worth buying with
your own time are the non-drill ones.`;

function positiveInt(raw: string | undefined, fallback: number, flag: string, max: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new Error(`--${flag} must be a whole number from 1 to ${max}`);
  }
  return n;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      topics: { type: "string" },
      course: { type: "string" },
      difficulty: { type: "string" },
      count: { type: "string" },
      styles: { type: "string" },
      formats: { type: "string" },
      target: { type: "string" },
      dir: { type: "string" },
      equivalence: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return;
  }

  // Created by the steps that write into it, not by `census`, which only reads.
  const dir = () => workspace(values.dir ?? DEFAULT_DIR);

  switch (command) {
    case "census":
      return runCensus(createServiceClient(), {
        course: values.course,
        target: positiveInt(values.target, 20, "target", 1000),
      });

    case "plan": {
      if (!values.topics) throw new Error(`plan needs --topics (see \`census\` for slugs)`);
      const slugs = splitList(values.topics);
      if (slugs.length === 0) throw new Error(`--topics needs at least one slug`);
      return runPlan(createServiceClient(), {
        slugs,
        difficulty: positiveInt(values.difficulty, 2, "difficulty", 5),
        count: positiveInt(values.count, 12, "count", 60),
        styles: parseEnumList(values.styles ?? "drill", PROBLEM_STYLES, "styles"),
        formats: parseEnumList(values.formats ?? "mcq,open", PROBLEM_FORMATS, "formats"),
        dir: dir(),
      });
    }

    // The one step with no database client and no key, which is what lets it be
    // run in a context that has never seen the answers.
    case "solve":
      return runSolve(dir());

    case "ingest": {
      const equivalence = values.equivalence ?? "defer";
      if (equivalence !== "defer" && equivalence !== "ai") {
        throw new Error(`--equivalence must be "defer" or "ai"`);
      }
      return runIngest(createServiceClient(), {
        dir: dir(),
        dryRun: values["dry-run"] ?? false,
        equivalence,
      });
    }

    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
