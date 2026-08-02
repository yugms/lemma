import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z, type ZodType } from "zod";

/**
 * Model provider.
 *
 * Google AI Studio's free tier is the default so lemma costs $0 to run: Flash
 * and Flash-Lite models are free (Pro tiers are not). Everything below is
 * env-overridable, so moving to a paid tier — or a different provider that
 * speaks the same "system prompt + JSON schema in, JSON out" shape — is a
 * config change plus a new `callStructured` body, not a rewrite.
 */

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
 * Free-tier request-per-minute limits are tight (~10 RPM), so verification
 * fans out narrowly and every call backs off on 429.
 */
export const AI_CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY ?? 3);

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
 * No single attempt may eat the entire budget and starve the fallbacks, but the
 * cap has to clear the time a real batch takes to write — too tight and every
 * model "times out" on work that would have succeeded.
 */
const MAX_ATTEMPT_MS = 60_000;

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Create a free key at https://aistudio.google.com/apikey and add it to .env.local"
      );
    }
    client = new GoogleGenAI({ apiKey });
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
  system,
  prompt,
  schema,
  images,
  maxOutputTokens = 8000,
  thinking = "low",
  budgetMs = DEFAULT_BUDGET_MS,
}: StructuredCall<T>): Promise<T | null> {
  const ai = getClient();
  const deadline = Date.now() + budgetMs;
  let lastError: unknown;

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
            abortSignal: AbortSignal.timeout(Math.min(remaining, MAX_ATTEMPT_MS)),
          },
        });

        const text = response.text;
        if (!text) return null;
        const parsed = schema.safeParse(JSON.parse(stripFence(text)));
        return parsed.success ? parsed.data : null;
      } catch (err) {
        // A bad request or unparseable response is this model's own problem —
        // another model would fail the same way. Only capacity errors fall through.
        if (!isRetryable(err)) return null;
        lastError = err;
        if (attempt < ATTEMPTS_PER_MODEL) {
          await sleep(Math.min(attempt * 1500, Math.max(0, deadline - Date.now())));
        }
      }
    }
  }

  throw new Error(
    `Every model was rate-limited, overloaded, or too slow within ${Math.round(budgetMs / 1000)}s ` +
      `(${models.join(", ")}). Last error: ` +
      (lastError instanceof Error ? lastError.message : String(lastError))
  );
}
