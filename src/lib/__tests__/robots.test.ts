import { describe, expect, it } from "vitest";
import { siteUrl } from "../env";
import robots, { AI_AGENTS } from "../../app/robots";

/**
 * Which crawlers are let in, and to what. Named user-agent groups *replace*
 * the wildcard group rather than adding to it, so this file exists mostly to
 * catch a private path that stops being disallowed for the agents that are
 * allowed in at all.
 */

describe("robots.txt", () => {
  const rules = () => {
    const result = robots().rules;
    return Array.isArray(result) ? result : [result];
  };

  it("keeps the private paths out of every group that is allowed in", () => {
    // Named user-agent groups replace the wildcard group rather than adding to
    // it, so a crawler matching one of these never reads the `*` rule. Listing
    // an agent by name to grant it access therefore also grants it everything
    // the wildcard rule was holding back, unless the disallows are repeated.
    for (const rule of rules()) {
      if (rule.disallow === "/") continue;
      expect(rule.disallow, `${String(rule.userAgent)} is allowed in`).toEqual(
        AI_AGENTS.privatePaths
      );
    }
  });

  it("puts each AI agent in exactly one group", () => {
    // A user-agent named twice is resolved by the crawler, not by us, and the
    // two vendors' search and training bots have confusingly similar names —
    // `ClaudeBot` trains, `Claude-SearchBot` searches.
    const all = [...AI_AGENTS.search, ...AI_AGENTS.training];
    expect(new Set(all.map((a) => a.toLowerCase())).size).toBe(all.length);
  });

  it("blocks the training crawlers outright", () => {
    const blocked = rules().find((r) => r.disallow === "/");
    expect(blocked?.userAgent).toEqual(AI_AGENTS.training);
    for (const agent of ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended"]) {
      expect(AI_AGENTS.training).toContain(agent);
      expect(AI_AGENTS.search).not.toContain(agent);
    }
  });

  it("still points at the sitemap", () => {
    expect(robots().sitemap).toBe(`${siteUrl()}/sitemap.xml`);
  });
});
