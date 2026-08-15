/**
 * Files and queries shared by the three seeding steps.
 *
 * The workspace is a directory of plain files rather than a database table or a
 * long-lived process, because the expensive step in between them is a person
 * (or an agent running under somebody's own subscription) reading one file and
 * writing another. A step that has to be resumable across days, editors and
 * sessions is a file on disk.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProblemFormat, ProblemStyle } from "@/lib/ai/kinds";

/**
 * Where a run keeps its files. Gitignored, and it has to stay that way: between
 * `plan` and `ingest` this directory holds full answer keys and worked
 * solutions for problems that are about to be served to students.
 */
export const DEFAULT_DIR = ".seed";

export const FILES = {
  plan: "plan.json",
  authoringBrief: "authoring-brief.md",
  problemSchema: "problem-schema.json",
  authored: "authored.json",
  solvingBrief: "solving-brief.md",
  solverSchema: "solver-schema.json",
  solveManifest: "solve-manifest.json",
  solved: "solved.json",
  adjudicate: "adjudicate.json",
  equivalenceBrief: "equivalence-brief.md",
  equivalenceSchema: "equivalence-schema.json",
  verdicts: "verdicts.json",
} as const;

/**
 * What `plan` decided, so `ingest` does not have to be told again.
 *
 * `topics` is the load-bearing field: an authored problem carries a
 * `topic_index`, which is an offset into the numbered list the brief showed —
 * meaningless without the list that produced it. Re-deriving it from the flags
 * at ingest time would silently re-tag every problem the moment the two
 * invocations disagreed about topic order.
 */
export type SeedPlan = {
  difficulty: number;
  styles: ProblemStyle[];
  formats: ProblemFormat[];
  count: number;
  topics: { id: string; slug: string; title: string }[];
};

export function workspace(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeFile(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, body, "utf8");
  return path;
}

export function writeJson(dir: string, name: string, value: unknown): string {
  return writeFile(dir, name, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Read one of the workspace files, naming the file and the step that writes it
 * when it isn't there.
 *
 * These are hand-authored between steps, so "not found" and "not valid JSON"
 * are the ordinary case rather than the exceptional one, and a raw ENOENT or a
 * bare `Unexpected token` says nothing about which of four files to go look at.
 */
export function readJson<T>(dir: string, name: string, writtenBy: string): T {
  const path = join(dir, name);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${path} not found — ${writtenBy}`);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON: ${err instanceof Error ? err.message : "parse failed"}`
    );
  }
}

/** The same, for a file that is only written when a step needed to ask something. */
export function readJsonIfPresent<T>(dir: string, name: string): T | null {
  if (!existsSync(join(dir, name))) return null;
  return readJson<T>(dir, name, "");
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Read every matching row, a page at a time.
 *
 * PostgREST caps a response at 1000 rows and says nothing about having done so.
 * A census is a count of what the pool already holds, and one that silently
 * stopped at 1000 reports every well-stocked cell as needing exactly as much
 * work as the thinnest one — which is the single number this whole tool exists
 * to get right.
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<Page<T>>,
  size = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < size) return rows;
  }
}

/**
 * The first thing wrong with a file a model wrote, as a field and a reason.
 *
 * Typed structurally rather than against `ZodError` so this file stays free of
 * the schema library it is describing failures from. Only the first issue: zod
 * reports every branch of a discriminated union separately, so a batch that got
 * one field wrong produces pages of them and the first is the useful one.
 */
type SchemaIssue = { path: PropertyKey[]; message: string };

export function schemaComplaint(error: { issues: SchemaIssue[] }): string {
  const issue = error.issues[0];
  if (!issue) return "no issue reported";
  return `${issue.path.length ? issue.path.join(".") : "(root)"} — ${issue.message}`;
}

/**
 * Wrap a block in a fence long enough to survive whatever is inside it.
 *
 * Both briefs quote prompts verbatim, and those prompts contain backticked
 * asides and fenced examples of their own. A three-backtick fence around them
 * closes early, which renders as the rules stopping halfway through — and the
 * reader has no way to tell that from rules that really do stop there.
 */
export function fence(body: string): string {
  const longest = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const bar = "`".repeat(Math.max(3, longest + 1));
  return `${bar}\n${body}\n${bar}`;
}

const quoteArg = (value: string) =>
  /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;

/**
 * How to invoke the next step, carrying `--dir` when the workspace isn't the
 * default one.
 *
 * Both briefs and both "Next:" lines name the following command, and a run
 * under `--dir` has to say so. `npm run seed -- ingest` on its own reads
 * `.seed`, where it finds none of the work that was just done and reports the
 * previous step as never having happened — which is a confusing way to be told
 * you typed the right thing in the wrong workspace.
 */
export function seedCommand(step: string, dir: string): string {
  const base = `npm run seed -- ${step}`;
  return dir === DEFAULT_DIR ? base : `${base} --dir ${quoteArg(dir)}`;
}

/** `a,b , c` -> `["a","b","c"]`, dropping the empties a trailing comma leaves. */
export function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * `--difficulty 1,3,5` -> `[1, 3, 5]`, refusing an empty list.
 *
 * `pickCells` iterates the difficulties, so none of them means no cells — and
 * `auto` reads no cells as "every cell has reached the target" and raises the
 * target. Under `--forever` that is a loop announcing a fresh round for as long
 * as it is left alone and authoring nothing, out of a flag as ordinary as
 * `--difficulty ""`. Deduplicated for the same reason `parseEnumList` is: a
 * repeated level is a repeated cell, authored twice onto one content hash.
 */
export function parseDifficulties(raw: string): number[] {
  const values = splitList(raw).map((d) => {
    const n = Number(d);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new Error(`--difficulty takes whole numbers from 1 to 5 (got "${d}")`);
    }
    return n;
  });
  if (values.length === 0) throw new Error(`--difficulty needs at least one level from 1 to 5`);
  return [...new Set(values)];
}

/**
 * Parse a comma-separated flag against a closed vocabulary, naming what was
 * allowed. `--formats mcq,opne` is a typo whose only other symptom is a brief
 * that quietly asks for one format fewer than intended.
 */
export function parseEnumList<T extends string>(
  raw: string,
  allowed: readonly T[],
  flag: string
): T[] {
  const values = splitList(raw);
  const bad = values.filter((v) => !(allowed as readonly string[]).includes(v));
  if (bad.length > 0) {
    throw new Error(`unknown ${flag}: ${bad.join(", ")} (allowed: ${allowed.join(", ")})`);
  }
  if (values.length === 0) throw new Error(`--${flag} needs at least one value`);
  return [...new Set(values)] as T[];
}
