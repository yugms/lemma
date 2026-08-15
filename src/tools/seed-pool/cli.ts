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
 * `auto` is those three in a loop with `claude -p` in the author's chair,
 * working down whichever cells the pool is thinnest at until the clock stops
 * it. Same steps, same gates; the only thing it replaces is the person.
 *
 * `bespoke()` builds — a focus set or a material set — skip pool reuse
 * entirely, so nothing seeded here reaches them. This makes ordinary builds
 * cheaper; it does not make targeted ones cheaper.
 */
import { parseArgs } from "node:util";
import { PROBLEM_FORMATS, PROBLEM_STYLES } from "@/lib/ai/kinds";
import { createServiceClient } from "@/lib/supabase/service";
import { requestStop, runAuto } from "@/tools/seed-pool/auto";
import { runCensus, runPlan } from "@/tools/seed-pool/plan";
import { runIngest } from "@/tools/seed-pool/ingest";
import { runSolve } from "@/tools/seed-pool/solve";
import {
  DEFAULT_DIR,
  parseDifficulties,
  parseEnumList,
  splitList,
  workspace,
} from "@/tools/seed-pool/shared";

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

  npm run seed -- auto [--forever] [options]
      All three, in a loop, with \`claude -p\` as the author. Re-censuses each
      round, works the thinnest (topic, difficulty) cells first, and rotates
      the styles and formats it asks for so the catalog fills evenly.
      --forever               keep going until stopped (otherwise --minutes)
      --minutes N             stop starting cells after this long (default 60)
      --jobs N                cells at once (default 1; 2-3 is usually fine)
      --verify gemini|claude  who checks the work (default gemini)
      --target N              depth a cell counts as stocked at (default 12);
                              once every cell reaches it, the loop deepens
      --difficulty <list>     levels to fill (default 1,2,3,4,5)
      --topics <list>         only these slugs (default: the whole catalog)
      --styles  <list>        default: every style but drill, which templates
                              already serve for free
      --formats <list>        default: every format
      --course, --count, --dry-run as above

      Each cell asks for a rotating slice of those styles and formats rather
      than all of them at once — a dozen problems spread over four styles and
      eight formats is one or two of each at the worst request count.

      \`gemini\` checks with the pipeline's own solver: a different model that
      never sees the workspace, at about three requests per twelve problems.
      \`claude\` spends no provider quota and is weaker — an author and a
      checker that are the same model share their blind spots.

  npm run seed -- stop
      Ask a running \`auto\` to finish its current cell and exit. For a run
      started in another window, where there is no Ctrl-C to send it.

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

function parseEquivalence(raw: string | undefined, fallback: "defer" | "ai"): "defer" | "ai" {
  const value = raw ?? fallback;
  if (value !== "defer" && value !== "ai") throw new Error(`--equivalence must be "defer" or "ai"`);
  return value;
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
      minutes: { type: "string" },
      jobs: { type: "string" },
      verify: { type: "string" },
      model: { type: "string" },
      forever: { type: "boolean", default: false },
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
      return runIngest(createServiceClient(), {
        dir: dir(),
        dryRun: values["dry-run"] ?? false,
        equivalence: parseEquivalence(values.equivalence, "defer"),
      });
    }

    case "auto": {
      const verify = values.verify ?? "gemini";
      if (verify !== "gemini" && verify !== "claude") {
        throw new Error(`--verify must be "gemini" or "claude"`);
      }
      return runAuto(createServiceClient(), {
        dir: dir(),
        course: values.course,
        slugs: values.topics ? splitList(values.topics) : undefined,
        difficulties: parseDifficulties(values.difficulty ?? "1,2,3,4,5"),
        // Every style but `drill` and every format, because the loop rotates a
        // slice of them per cell and the whole list is what it rotates through.
        // `drill` is left out on purpose: templates already serve it for free
        // and deterministically, so authoring it buys nothing.
        styles: parseEnumList(
          values.styles ?? PROBLEM_STYLES.filter((s) => s !== "drill").join(","),
          PROBLEM_STYLES,
          "styles"
        ),
        formats: parseEnumList(values.formats ?? PROBLEM_FORMATS.join(","), PROBLEM_FORMATS, "formats"),
        count: positiveInt(values.count, 12, "count", 60),
        target: positiveInt(values.target, 12, "target", 1000),
        minutes: positiveInt(values.minutes, 60, "minutes", 24 * 60),
        forever: values.forever ?? false,
        jobs: positiveInt(values.jobs, 1, "jobs", 8),
        verify,
        // Prose answers are the case local comparison can never settle, and in
        // a loop with nobody watching there is no `adjudicate.json` round trip
        // to defer them to — so the default spends the call. `defer` is the
        // opt-out, and it drops those problems rather than guessing at them.
        equivalence: parseEquivalence(values.equivalence, "ai"),
        model: values.model,
        dryRun: values["dry-run"] ?? false,
      });
    }

    // No database client and no flags of its own: it writes one file that a
    // running loop is watching for, so it works from any window on the machine.
    case "stop": {
      console.log(`Wrote ${requestStop(dir())}`);
      console.log(`A running \`auto\` will finish its current cell and exit.`);
      return;
    }

    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((err: unknown) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
