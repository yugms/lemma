import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/** Every call the fake SDK received, in order, so we can assert on the walk. */
const seen: string[] = [];
/** model -> what that model should do when called. */
const behaviour = new Map<string, () => unknown>();

const generateContent = vi.fn(async ({ model }: { model: string }) => {
  seen.push(model);
  const act = behaviour.get(model);
  if (!act) throw new Error(`no behaviour registered for ${model}`);
  return act();
});

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  HarmBlockThreshold: { BLOCK_MEDIUM_AND_ABOVE: "BLOCK_MEDIUM_AND_ABOVE" },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: "HARM_CATEGORY_HARASSMENT",
    HARM_CATEGORY_HATE_SPEECH: "HARM_CATEGORY_HATE_SPEECH",
    HARM_CATEGORY_SEXUALLY_EXPLICIT: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    HARM_CATEGORY_DANGEROUS_CONTENT: "HARM_CATEGORY_DANGEROUS_CONTENT",
  },
  ThinkingLevel: { LOW: "LOW", MEDIUM: "MEDIUM" },
}));
vi.mock("@/lib/env", () => ({ geminiApiKey: () => "test-key" }));

const { callStructured, clearModelBlocks } = await import("@/lib/ai/provider");

const schema = z.object({ ok: z.boolean() });
const ask = (models: string[]) =>
  callStructured({ models, system: "s", prompt: "p", schema, budgetMs: 5_000 });

const ok = () => ({ text: JSON.stringify({ ok: true }), candidates: [{ finishReason: "STOP" }] });

/** The 404 a model retired out from under the chain returns. */
const retired = (model: string) =>
  Object.assign(new Error(`This model models/${model} is no longer available to new users.`), {
    status: 404,
  });

/** The 429 the free tier returns once a model's daily request cap is spent. */
const dailyQuota = () =>
  Object.assign(
    new Error(
      "You exceeded your current quota. Quota exceeded for metric: " +
        "generativelanguage.googleapis.com/generate_content_free_tier_requests, " +
        'quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier". Please retry in 39.4s'
    ),
    { status: 429 }
  );

const overloaded = () => Object.assign(new Error("The model is overloaded."), { status: 503 });

beforeEach(() => {
  seen.length = 0;
  behaviour.clear();
  generateContent.mockClear();
  clearModelBlocks();
});

describe("model chain walk", () => {
  // The production failure: `gemini-2.5-flash` sat at the tail of both chains
  // and answers 404. A non-retryable error abandoned the whole chain, so the
  // models behind it were never reached and — worse — the capacity throw never
  // fired, leaving callers a null they read as "the model wrote rubbish".
  it("keeps going when a model has been retired", async () => {
    behaviour.set("dead", () => {
      throw retired("dead");
    });
    behaviour.set("alive", ok);

    await expect(ask(["dead", "alive"])).resolves.toEqual({ ok: true });
    expect(seen).toEqual(["dead", "alive"]);
  });

  it("spends no retries on a model that is out of its daily quota", async () => {
    behaviour.set("spent", () => {
      throw dailyQuota();
    });
    behaviour.set("fresh", ok);

    await expect(ask(["spent", "fresh"])).resolves.toEqual({ ok: true });
    // One attempt, not three: waiting cannot return a daily allowance.
    expect(seen).toEqual(["spent", "fresh"]);
  });

  it("still retries a model that is merely busy", async () => {
    let calls = 0;
    behaviour.set("busy", () => {
      calls += 1;
      if (calls === 1) throw overloaded();
      return ok();
    });

    await expect(ask(["busy"])).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("remembers an exhausted model instead of rediscovering it every call", async () => {
    behaviour.set("spent", () => {
      throw dailyQuota();
    });
    behaviour.set("fresh", ok);

    await ask(["spent", "fresh"]);
    await ask(["spent", "fresh"]);

    // The second call skips the spent model entirely — this is most of the
    // minute a failing build used to spend re-proving the same 429.
    expect(seen).toEqual(["spent", "fresh", "fresh"]);
  });
});

describe("what reaches the caller", () => {
  it("throws when every model is out of capacity, so the outage is nameable", async () => {
    behaviour.set("a", () => {
      throw dailyQuota();
    });
    behaviour.set("b", () => {
      throw retired("b");
    });

    await expect(ask(["a", "b"])).rejects.toThrow(/rate-limited|overloaded|too slow/);
  });

  it("throws rather than returning null when every model is already blocked", async () => {
    behaviour.set("a", () => {
      throw dailyQuota();
    });
    await expect(ask(["a"])).rejects.toThrow();

    seen.length = 0;
    await expect(ask(["a"])).rejects.toThrow(/out of quota/);
    expect(seen).toEqual([]);
  });

  it("returns null on a bad request without trying the rest of the chain", async () => {
    // Another model would fail an invalid schema identically, so walking on
    // just spends the budget to arrive at the same answer.
    behaviour.set("first", () => {
      throw Object.assign(new Error("Invalid JSON payload received."), { status: 400 });
    });
    behaviour.set("second", ok);

    await expect(ask(["first", "second"])).resolves.toBeNull();
    expect(seen).toEqual(["first"]);
  });

  it("returns null when a model answers with unusable text", async () => {
    behaviour.set("sloppy", () => ({
      text: "not json at all",
      candidates: [{ finishReason: "STOP" }],
    }));

    await expect(ask(["sloppy"])).resolves.toBeNull();
  });
});
