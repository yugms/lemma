import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  type SafetySetting,
} from "@google/genai";
import { z, type ZodType } from "zod";
import { geminiApiKey } from "@/lib/env";

/**
 * Model provider.
 *
 * Google AI Studio's free tier is the default so lemma costs $0 to run: Flash
 * and Flash-Lite models are free (Pro tiers are not). Everything below is
 * env-overridable, so moving to a paid tier — or a different provider that
 * speaks the same "system prompt + JSON schema in, JSON out" shape — is a
 * config change plus a new `callStructured` body, not a rewrite.
 */

/**
 * Both numbers below fail badly rather than loudly when mistyped: `Number("六")`
 * is NaN, and NaN silently disables the concurrency pool in one case and makes
 * `Math.ceil(wanted / NaN)` produce *zero* authoring calls in the other — an
 * empty set with nothing in the logs to explain it. Fall back to the default.
 */
function positiveInt(env: string | undefined, fallback: number): number {
  const parsed = Number(env);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const modelList = (env: string | undefined, fallback: string[]) =>
  env
    ? env
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean)
    : fallback;

/**
 * Preference-ordered model chains. Free-tier capacity fluctuates — the newest
 * Flash models return 503 "high demand" in bursts — so each role falls through
 * to an older sibling rather than failing a student's request outright.
 */

/**
 * Authors problems and repairs them. Needs the most reasoning.
 *
 * The strong models lead and the lites catch what falls through, which is the
 * point of ordering the chain — but only works if the tail is alive. It was
 * not: `gemini-2.5-flash` sat at the end of both chains and answers 404 ("no
 * longer available to new users"), so the fallback that was supposed to absorb
 * a rate-limited flash absorbed nothing. The two flash models share a 20/day
 * free-tier cap between them, so the lites are the working budget most days.
 */
export const GENERATOR_MODELS = modelList(process.env.GEMINI_GENERATOR_MODELS, [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
]);
/** Independent solver, answer-equivalence, misconception feedback. Cheap and fast. */
export const CHECKER_MODELS = modelList(process.env.GEMINI_CHECKER_MODELS, [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
]);

/**
 * Concurrent model calls allowed inside one set build.
 *
 * This used to bound verification alone, which was safe while authoring ran
 * strictly one call at a time. Authoring fans out too now, so the number has to
 * be the whole build's budget against the free tier's tight (~10 RPM) limit
 * rather than one phase's — see `createCallPool`.
 */
export const AI_CONCURRENCY = positiveInt(process.env.GEMINI_CONCURRENCY, 6);

/**
 * Problems solved by one verification call — the other half of the request
 * budget, and the half that used to scale with the set no matter what.
 *
 * Small on purpose, and not for the same reason `PROBLEMS_PER_CALL` is large.
 * The independent solve is the quality gate the whole pipeline rests on: a long
 * shared context is where a solver starts pattern-matching across problems
 * rather than solving each one, and one unusable response should cost a few
 * re-solves rather than a set's whole verification.
 */
export const SOLVES_PER_CALL = positiveInt(process.env.GEMINI_SOLVES_PER_CALL, 5);

/**
 * Problems asked for in one authoring call — the other half of the same
 * throughput dial, which is why it lives here rather than next to its caller.
 *
 * Smaller looks like it should be faster, since the calls now run side by side
 * and a model writes a batch one token at a time. Measured, it is not: a call
 * spends 3.5-7k thinking tokens planning the batch almost regardless of how
 * many problems it holds, so halving the batch roughly doubles that overhead
 * and puts twice the pressure on a free tier that answers bursts with 503s.
 * Twelve problems took 58s at six per call and 66s at three.
 */
export const PROBLEMS_PER_CALL = positiveInt(process.env.GEMINI_PROBLEMS_PER_CALL, 6);

/** Attempts per model before falling through to the next one in the chain. */
const ATTEMPTS_PER_MODEL = 3;

/**
 * Wall-clock budget for one logical call, spanning every retry and every model
 * in the chain. The SDK does not time out on its own, so without this a single
 * hung request stalls the whole set build until the serverless function's own
 * limit kills it — delivering nothing. A timeout is treated like a capacity
 * error, so it falls through to the next model rather than failing outright.
 */
const DEFAULT_BUDGET_MS = 60_000;
/**
 * Floor on what one attempt may use. The cap itself is derived from the caller's
 * budget, because a flat ceiling is wrong in the one place it matters: the
 * generator asks for 150s to write a batch, and clamping each attempt to 60s
 * aborted batches that were still being written. An abort is classified
 * retryable, so the call then spent the rest of its budget on retries that were
 * always going to be cut off at exactly the same point — 150s to produce
 * nothing. Half the budget still leaves room for a fallback model to try.
 */
const MIN_ATTEMPT_MS = 60_000;

const attemptCap = (budgetMs: number) => Math.max(MIN_ATTEMPT_MS, Math.floor(budgetMs / 2));

/**
 * One line per model call.
 *
 * Nothing recorded how long a call took, which model answered, or whether a
 * fallback fired, so a slow build and a stalled one looked identical from the
 * outside. This is the only function that talks to the SDK, so it is the only
 * place that has to be instrumented to see all of it.
 *
 * The prefix separates on a slash rather than a colon for a reason that has
 * nothing to do with logging. A bracketed name-colon-value pair is exactly
 * Tailwind's arbitrary-property syntax, and its class scanner reads every file
 * in the project — source, comments, this one. It found the old prefix here and
 * emitted it as a real (invalid) declaration into the stylesheet every visitor
 * downloads. `@source not` is the documented way to exclude a path and had no
 * effect under Turbopack, so the fix is to stop writing something that looks
 * like a utility. Do not spell the old form out anywhere in this repo, comment
 * or not, or it comes straight back.
 */
function trace(fields: Record<string, string | number | undefined>): void {
  const line = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.info(`[lemma/ai] ${line}`);
}

/**
 * Serializes work onto a fixed number of slots.
 *
 * Authoring and verification are no longer separate phases with separate
 * limits — they overlap and both fan out — so they have to draw from one pool.
 * With a limit each they would burst to the sum of the two and spend the
 * difference in 429 backoff, which costs more wall clock than the concurrency
 * bought.
 */
export type CallPool = <T>(fn: () => Promise<T>) => Promise<T>;

export function createCallPool(limit: number): CallPool {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    // Re-check on wake rather than trusting the handoff: releasing a slot and
    // resuming the waiter are two turns of the event loop, and another caller
    // can arrive in between.
    while (active >= limit) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: geminiApiKey() });
  }
  return client;
}

/**
 * Gemini accepts JSON Schema but only supports `$ref` in non-required
 * properties, so inline every definition. Cached per zod schema — the JSON
 * Schema conversion is pure and these are module-level constants.
 */
const schemaCache = new WeakMap<ZodType, unknown>();

export function jsonSchemaFor(schema: ZodType): unknown {
  const cached = schemaCache.get(schema);
  if (cached) return cached;
  const json = z.toJSONSchema(schema, {
    target: "draft-07",
    reused: "inline",
    io: "output",
    unrepresentable: "any",
  }) as Record<string, unknown>;
  delete json.$schema;
  schemaCache.set(schema, json);
  return json;
}

/** Gemini 3.x takes `thinkingLevel`; 2.5 takes `thinkingBudget`. Only send what the model understands. */
function thinkingConfigFor(model: string, level: "low" | "medium") {
  if (!model.startsWith("gemini-3")) return undefined;
  return {
    thinkingLevel: level === "low" ? ThinkingLevel.LOW : ThinkingLevel.MEDIUM,
  };
}

/**
 * Google states the wait it wants twice — once in prose, once in a RetryInfo
 * detail — and neither survives into an Error field, so it is read back out of
 * the message. Worth honouring: a fixed backoff either sleeps through a wait
 * that was over in two seconds or hammers a limit that wanted forty.
 */
function retryAfterMs(message: string): number | null {
  const m =
    message.match(/retry in ([\d.]+)\s*s/i) ?? message.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (!m) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

/**
 * How a call failed, in the three ways that call for different responses.
 *
 * This used to be a boolean, and the case it collapsed is the one that broke
 * production: a model retired out from under the chain answers 404, which is
 * not retryable, and "not retryable" meant *abandon the whole chain and return
 * null*. So when both flash models were rate-limited and the 2.5 fallback
 * behind them was dead, the capacity error never reached the throw that says
 * so — every caller saw an ordinary null, and a student was told no problem
 * passed verification when nothing had been written to verify.
 */
type Failure =
  /** Busy. Worth another attempt here, then the next model. */
  | { kind: "capacity"; retryAfterMs: number | null }
  /** This model can't serve it; says nothing about the next one. Skip it. */
  | { kind: "model"; blockForMs: number }
  /** The request is wrong. Every model fails it identically — stop. */
  | { kind: "request" };

/**
 * A daily cap won't clear inside this request, but Google's own retryDelay
 * disagrees — it offered 39s against a quota it documents as per-day — so the
 * hint is floored rather than trusted. Long enough that one build stops
 * rediscovering the same exhausted model on all ~100 of its calls, short enough
 * that a sliding window handing capacity back is picked up in the same session.
 */
const MIN_QUOTA_BLOCK_MS = 60_000;
/** A retired model is not coming back; this only bounds a misread 404. */
const MODEL_GONE_MS = 60 * 60_000;

function classify(err: unknown): Failure {
  const status = (err as { status?: number })?.status;
  const name = (err as { name?: string })?.name;
  const message = String((err as { message?: string })?.message ?? err);

  if (name === "AbortError" || name === "TimeoutError")
    return { kind: "capacity", retryAfterMs: null };

  if (status === 404 || /NOT_FOUND|no longer available/i.test(message))
    return { kind: "model", blockForMs: MODEL_GONE_MS };

  if (status === 429 || /RESOURCE_EXHAUSTED|\b429\b/.test(message)) {
    const wait = retryAfterMs(message);
    // Per-day and per-minute quotas arrive as the same status and read the same
    // in prose; only `quotaId` separates them, and the difference is whether
    // waiting is worth anything at all.
    if (/PerDay|RequestsPerDay/i.test(message))
      return { kind: "model", blockForMs: Math.max(wait ?? 0, MIN_QUOTA_BLOCK_MS) };
    return { kind: "capacity", retryAfterMs: wait };
  }

  if (status === 500 || status === 503 || /UNAVAILABLE|\b503\b|overloaded/i.test(message))
    return { kind: "capacity", retryAfterMs: retryAfterMs(message) };

  if (/abort|timed? ?out/i.test(message)) return { kind: "capacity", retryAfterMs: null };

  return { kind: "request" };
}

/**
 * Models known to be out of quota, and when they are worth trying again.
 *
 * Module scope so it outlives one build on a warm lambda, keyed by model
 * because the quotas are per-model. Without it, every one of the ~100 calls a
 * set build makes rediscovers the same exhausted model — three attempts and two
 * backoffs each — which is most of the minute a failing build spent spinning.
 */
const modelBlockedUntil = new Map<string, number>();

const modelIsBlocked = (model: string) => (modelBlockedUntil.get(model) ?? 0) > Date.now();

/** Exported for tests; a process restart clears it anyway. */
export function clearModelBlocks() {
  modelBlockedUntil.clear();
}

/** Models occasionally wrap JSON in a code fence even under a response schema. */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Base64 image data, as Gemini's `inlineData` wants it. */
export type ImagePart = {
  /** e.g. "image/jpeg", "image/png", "image/webp" */
  mimeType: string;
  /** Base64, without a data: URL prefix. */
  data: string;
};

export type StructuredCall<T> = {
  /** Preference-ordered model chain; later entries are tried only on 429/503. */
  models: string[];
  /** Names this call in the trace log — "author:mcq", "solve", "coach". */
  label?: string;
  system: string;
  prompt: string;
  schema: ZodType<T>;
  /**
   * Images the model should read alongside the prompt — photographed worksheets.
   * Every model in both chains is multimodal, so no separate chain is needed.
   */
  images?: ImagePart[];
  maxOutputTokens?: number;
  thinking?: "low" | "medium";
  /** Total wall clock allowed across all retries and fallback models. */
  budgetMs?: number;
  /**
   * Content thresholds for this call only.
   *
   * Deliberately per-call rather than a default. The authoring and grading
   * chains work on maths the app itself produced or a student typed, and
   * tightening them there buys nothing while risking a false positive on a word
   * problem about, say, dividing up a hospital's beds. Reading a file somebody
   * chose is a different proposition, so `STRICT_SAFETY` is set there and
   * nowhere else.
   */
  safety?: SafetySetting[];
};

/**
 * Thresholds for a call whose input is a file the caller chose.
 *
 * Worth being precise about what this is: a *content policy* gate. It scores
 * harm categories, and it will not stop "ignore your instructions" — the block
 * reason list includes JAILBREAK, which helps, but the boundary that actually
 * holds is `MaterialDigestSchema`, where nothing but closed enums and capped
 * strings can get out. Anyone weakening the digest because this exists has
 * traded a wall for a filter.
 */
export const STRICT_SAFETY: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }));

/**
 * One structured-output call, retried across a model chain.
 *
 * Returns null when a model answers with something unusable — every caller has
 * a discard path, and a short set beats a failed request. Throws only when the
 * whole chain is rate-limited or overloaded, which is worth surfacing to the
 * student as "try again in a minute" rather than an empty result.
 */
export async function callStructured<T>({
  models,
  label = "call",
  system,
  prompt,
  schema,
  images,
  maxOutputTokens = 8000,
  thinking = "low",
  budgetMs = DEFAULT_BUDGET_MS,
  safety,
}: StructuredCall<T>): Promise<T | null> {
  const ai = getClient();
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const perAttemptMs = attemptCap(budgetMs);
  const elapsed = () => Date.now() - startedAt;
  let lastError: unknown;
  let calls = 0;

  // Images lead so the instruction that follows can refer back to them ("the
  // pages above"). A bare string stays a bare string — the text-only callers
  // are the hot path and their request shape must not shift.
  const contents = images?.length
    ? [...images.map((image) => ({ inlineData: image })), { text: prompt }]
    : prompt;

  /** Models skipped outright because they are already known to be out. */
  const skipped: string[] = [];

  for (const model of models) {
    if (modelIsBlocked(model)) {
      skipped.push(model);
      continue;
    }
    // Set when this model turns out to be unusable, so the remaining attempts
    // against it are abandoned without abandoning the models behind it.
    let modelIsDone = false;
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL && !modelIsDone; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      calls++;
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchemaFor(schema),
            maxOutputTokens,
            thinkingConfig: thinkingConfigFor(model, thinking),
            safetySettings: safety,
            abortSignal: AbortSignal.timeout(Math.min(remaining, perAttemptMs)),
          },
        });

        const usage = response.usageMetadata;
        // `finishReason` is the tell for the failure that otherwise looks like a
        // sulky model: a batch cut off at `maxOutputTokens` returns text that
        // cannot parse, which is indistinguishable from garbage without it.
        const finish = String(response.candidates?.[0]?.finishReason ?? "STOP");
        const outcome = (result: string) =>
          trace({
            label,
            model,
            calls,
            ms: elapsed(),
            result,
            finish: finish === "STOP" ? undefined : finish,
            in: usage?.promptTokenCount,
            out: usage?.candidatesTokenCount,
            think: usage?.thoughtsTokenCount,
          });

        const text = response.text;
        if (!text) {
          // A refusal and a sulk both arrive as no text, and telling them apart
          // matters most for the one call whose input someone else chose. The
          // two live in different places: an *input* blocked before generation
          // produces no candidates at all, so `finishReason` never sees it and
          // only `promptFeedback` says why. Traced, not branched on — the
          // contract is still that unusable output returns null.
          const blocked = response.promptFeedback?.blockReason;
          outcome(blocked ? `blocked:${blocked}` : finish === "STOP" ? "empty" : "cut-off");
          return null;
        }
        const parsed = schema.safeParse(JSON.parse(stripFence(text)));
        outcome(parsed.success ? "ok" : "schema-mismatch");
        return parsed.success ? parsed.data : null;
      } catch (err) {
        const failure = classify(err);
        // A malformed request or unparseable response is the request's own
        // problem — another model fails it identically, so stop here.
        if (failure.kind === "request") {
          trace({ label, model, calls, ms: elapsed(), result: "rejected", error: errorText(err) });
          return null;
        }
        lastError = err;
        if (failure.kind === "model") {
          modelBlockedUntil.set(model, Date.now() + failure.blockForMs);
          trace({ label, model, calls, ms: elapsed(), result: "unusable", error: errorText(err) });
          modelIsDone = true;
          continue;
        }
        trace({ label, model, calls, ms: elapsed(), result: "retryable", error: errorText(err) });
        if (attempt < ATTEMPTS_PER_MODEL) {
          const room = Math.max(0, deadline - Date.now());
          const wait = failure.retryAfterMs ?? attempt * 1500;
          // Sleeping past our own deadline helps nobody — hand what is left of
          // the budget to the next model instead.
          if (wait > room) break;
          await sleep(wait);
        }
      }
    }
  }

  trace({
    label,
    calls,
    ms: elapsed(),
    result: "exhausted",
    error: lastError ? errorText(lastError) : undefined,
    skipped: skipped.length ? skipped.join(",") : undefined,
  });
  // Reaching here means capacity, not correctness — every path that blames the
  // request returns null above. Callers distinguish the two, and a student is
  // told the writer is busy rather than that their settings were unusable.
  throw new Error(
    `Every model was rate-limited, overloaded, or too slow within ${Math.round(budgetMs / 1000)}s ` +
      `(${models.join(", ")}). ` +
      (lastError instanceof Error
        ? `Last error: ${lastError.message}`
        : skipped.length === models.length
          ? "All models are out of quota for now."
          : `Last error: ${String(lastError)}`)
  );
}

/** One-line error text for the trace — the full stack is noise at this volume. */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify(message.slice(0, 120));
}
