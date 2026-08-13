import { describe, expect, it } from "vitest";
import {
  capFor,
  clientIp,
  DAILY_LIMITS,
  IP_LIMITS,
  startOfToday,
  type LimitKind,
} from "../limits";

/**
 * The spend caps, per account and per network. A cap with the wrong sign lets
 * everything through and nothing says so; one tuned too tight makes a whole
 * classroom behind one address look like a broken site.
 */

describe("daily limits", () => {
  const kinds = Object.keys(DAILY_LIMITS) as LimitKind[];

  it("is never more generous to a guest than to a signed-in user", () => {
    for (const kind of kinds) {
      const { guest, member } = DAILY_LIMITS[kind];
      expect(guest, `${kind} guest cap`).toBeGreaterThan(0);
      expect(member, `${kind} member cap`).toBeGreaterThanOrEqual(guest);
    }
  });

  it("picks the cap by account type", () => {
    for (const kind of kinds) {
      expect(capFor(kind, true)).toBe(DAILY_LIMITS[kind].guest);
      expect(capFor(kind, false)).toBe(DAILY_LIMITS[kind].member);
    }
  });

  it("gives grading a budget far above ordinary practice", () => {
    // Being over this one degrades what a student gets back, unlike the others
    // which simply refuse. A long session is tens of problems, not hundreds —
    // if this ever drops near that range, the degradation stops being rare.
    expect(DAILY_LIMITS.aiGrading.guest).toBeGreaterThanOrEqual(50);
    expect(DAILY_LIMITS.aiGrading.member).toBeGreaterThanOrEqual(150);
  });

  it("counts from local midnight", () => {
    const since = startOfToday();
    expect([since.getHours(), since.getMinutes(), since.getSeconds()]).toEqual([0, 0, 0]);
    expect(since.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("per-network limits", () => {
  it("measures every bucket against a per-user cap that exists", () => {
    // The check below indexes DAILY_LIMITS by an IP_LIMITS key through a cast,
    // so a bucket with no matching daily cap reads `undefined.member` and takes
    // the whole suite down with a TypeError rather than naming what is missing.
    for (const kind of Object.keys(IP_LIMITS)) {
      expect(DAILY_LIMITS[kind as LimitKind], `${kind} has no per-user cap`).toBeDefined();
    }
  });

  it("leaves room for a shared network on every bucket", () => {
    // The failure mode these are tuned against is a classroom or a library
    // behind one address, where thirty students look like one caller. A burst
    // allowance at or below the per-user daily cap lets one student spend the
    // whole room's, and to everyone else the site just appears broken — which
    // gets reported as a bug rather than as a limit, if it gets reported at all.
    for (const [kind, limit] of Object.entries(IP_LIMITS)) {
      const perUserDaily = DAILY_LIMITS[kind as keyof typeof IP_LIMITS].member;
      expect(limit.burst.max, `${kind} burst`).toBeGreaterThanOrEqual(perUserDaily * 1.5);
      expect(limit.day.max, `${kind} day`).toBeGreaterThan(limit.burst.max);
      expect(limit.burst.seconds, `${kind} burst window`).toBeLessThan(limit.day.seconds);
    }
  });

  it("reads the edge-set header in preference to the client-set one", () => {
    // `x-forwarded-for` is whatever the caller sent until a proxy overwrites
    // it; `x-vercel-forwarded-for` is stamped at the edge. Preferring the
    // wrong one would let a caller pick its own bucket, and therefore a fresh
    // allowance per request.
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1",
    });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("takes only the first hop, and nothing when there is no header", () => {
    // The tail of an XFF chain is proxies, not callers — counting a proxy as
    // its own subject would give every request through it a clean slate.
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 70.41.3.18" }))).toBe(
      "203.0.113.7"
    );
    expect(clientIp(new Headers({ "x-forwarded-for": "  203.0.113.7  " }))).toBe("203.0.113.7");
    // Local development has neither header; `ipAllowance` reads null as "skip".
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBeNull();
  });
});
