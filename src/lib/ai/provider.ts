import { GoogleGenAI, ThinkingLevel } from "@google/genai";
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

/** Authors problems and repairs them. Needs the most reasoning. */
export const GENERATOR_MODELS = modelList(process.env.GEMINI_GENERATOR_MODELS, [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-2.5-flash",
]);
/** Independent solver, answer-equivalence, misconception feedback. Cheap and fast. */
export const CHECKER_MODELS = modelList(process.env.GEMINI_CHECKER_MODELS, [
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
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
 */
function trace(fields: Record<string, string | number | undefined>): void {
  const line = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.info(`[lemma:ai] ${line}`);
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

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 500 || status === 503) return true;
  const name = (err as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = String((err as { message?: string })?.message ?? err);
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|429|503|overloaded|abort|timed? ?out/i.test(message);
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
};

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

  for (const model of models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
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
          outcome("empty");
          return null;
        }
        const parsed = schema.safeParse(JSON.parse(stripFence(text)));
        outcome(parsed.success ? "ok" : "schema-mismatch");
        return parsed.success ? parsed.data : null;
      } catch (err) {
        // A bad request or unparseable response is this model's own problem —
        // another model would fail the same way. Only capacity errors fall through.
        if (!isRetryable(err)) {
          trace({ label, model, calls, ms: elapsed(), result: "rejected", error: errorText(err) });
          return null;
        }
        lastError = err;
        trace({ label, model, calls, ms: elapsed(), result: "retryable", error: errorText(err) });
        if (attempt < ATTEMPTS_PER_MODEL) {
          await sleep(Math.min(attempt * 1500, Math.max(0, deadline - Date.now())));
        }
      }
    }
  }

  trace({ label, calls, ms: elapsed(), result: "exhausted", error: errorText(lastError) });
  throw new Error(
    `Every model was rate-limited, overloaded, or too slow within ${Math.round(budgetMs / 1000)}s ` +
      `(${models.join(", ")}). Last error: ` +
      (lastError instanceof Error ? lastError.message : String(lastError))
  );
}

/** One-line error text for the trace — the full stack is noise at this volume. */
function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return JSON.stringify(message.slice(0, 120));
}
