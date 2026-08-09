import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { CoachRead } from "@/lib/ai/schemas";
import type { StatsSnapshot } from "@/lib/analytics";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/provider")>();
  return { ...actual, callStructured: vi.fn() };
});

const { createServiceClient } = await import("@/lib/supabase/service");
const { callStructured } = await import("@/lib/ai/provider");
const { cachedCoachRead, loadCoachRead, coachSignature } = await import("@/lib/ai/coach");

const client = createServiceClient as unknown as Mock;
const call = callStructured as unknown as Mock;

const READ: CoachRead = {
  diagnosis: "You drop negatives under distribution.",
  focus_areas: [{ label: "Sign handling", why: "Four misses trace to a dropped minus." }],
  generator_directives: ["Include problems where a negative must survive distribution."],
};

let upserts: unknown[] = [];

/** Just enough of the postgrest builder for the two chains coach.ts uses. */
function fakeDb(rows: { signature: string; read: CoachRead }[] | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ limit: async () => ({ data: rows }) }) }),
      }),
      upsert: async (row: unknown) => {
        upserts.push(row);
        return {};
      },
    }),
  };
}

const snapshot = (over: Partial<StatsSnapshot["totals"]> = {}) =>
  ({
    totals: { answered: 40, correct: 21, revealed: 3, accuracy: 53, ...over },
    lastAttemptAt: "2026-08-01T10:00:00.000Z",
    byTopic: [],
    byFormat: [],
    byStyle: [],
    byDifficulty: [],
    mistakes: [],
  }) as unknown as StatsSnapshot;

beforeEach(() => {
  call.mockReset();
  client.mockReset();
  upserts = [];
});

describe("cachedCoachRead", () => {
  it("never calls the model", async () => {
    client.mockReturnValue(fakeDb([{ signature: "stale", read: READ }]));

    await cachedCoachRead("user-1", "all");

    expect(call).not.toHaveBeenCalled();
  });

  it("returns a read written against a different signature", async () => {
    // The build path takes whatever exists: the fresh snapshot picks the set's
    // topics and level, so a slightly old read still describes this student —
    // and no read at all is the worse answer.
    client.mockReturnValue(fakeDb([{ signature: "written-earlier", read: READ }]));

    await expect(cachedCoachRead("user-1", "all")).resolves.toEqual(READ);
  });

  it("returns null when nothing is cached", async () => {
    client.mockReturnValue(fakeDb([]));

    await expect(cachedCoachRead("user-1", "all")).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the lookup fails", async () => {
    client.mockImplementation(() => {
      throw new Error("db down");
    });

    await expect(cachedCoachRead("user-1", "all")).resolves.toBeNull();
  });
});

describe("loadCoachRead still generates for /stats", () => {
  it("uses the cache on an exact signature match", async () => {
    const snap = snapshot();
    client.mockReturnValue(fakeDb([{ signature: coachSignature(snap), read: READ }]));

    await expect(loadCoachRead("user-1", "all", snap)).resolves.toEqual(READ);
    expect(call).not.toHaveBeenCalled();
  });

  it("regenerates and caches when the student has practised since", async () => {
    client.mockReturnValue(fakeDb([{ signature: "written-earlier", read: READ }]));
    call.mockResolvedValue(READ);

    await expect(loadCoachRead("user-1", "all", snapshot())).resolves.toEqual(READ);
    expect(call).toHaveBeenCalledTimes(1);
    expect(upserts).toHaveLength(1);
  });

  it("does not ask below four graded attempts", async () => {
    client.mockReturnValue(fakeDb([]));

    await expect(loadCoachRead("user-1", "all", snapshot({ answered: 3 }))).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });
});
