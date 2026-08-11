import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/env";

/**
 * Owner-scoped and auth-gated; nothing there is crawlable anyway. `/account`
 * holds a signed-in user's data controls and `/signin` is a redirect target —
 * neither is a useful search result.
 */
const PRIVATE_PATHS = ["/api/", "/set/", "/auth/", "/account", "/signin"];

/**
 * Agents that answer a question someone is asking right now — either indexing
 * for an AI search product or fetching a page because a user pasted the link.
 * They are how lemma gets cited, so they get the same access as Googlebot.
 */
const AI_SEARCH_AGENTS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Applebot",
];

/**
 * Agents that collect pages into a training corpus. Blocked.
 *
 * Worth being clear-eyed about what this is: a stated preference that
 * well-behaved crawlers honour, not an access control. Anything that ignores
 * robots.txt is unaffected, and the per-network limits in `limits.ts` are what
 * actually bound abuse.
 *
 * The split within each vendor is the part that is easy to get backwards.
 * `GPTBot` is OpenAI's training crawler while `OAI-SearchBot` serves ChatGPT
 * search; `ClaudeBot` is Anthropic's training crawler while `Claude-SearchBot`
 * and `Claude-User` serve search and user-initiated fetches; `Google-Extended`
 * governs Gemini training only and has no effect on Google Search ranking.
 */
const AI_TRAINING_AGENTS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "meta-externalagent",
  "FacebookBot",
  "Diffbot",
  "Omgilibot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      // Named groups *replace* the `*` group rather than adding to it — a
      // crawler that matches one of these never reads the rule above. So the
      // private paths have to be repeated here, or naming these agents would
      // hand them the one thing the wildcard rule keeps back.
      { userAgent: AI_SEARCH_AGENTS, allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_TRAINING_AGENTS, disallow: "/" },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

/** Exported for `production.test.ts`, which pins the two groups apart. */
export const AI_AGENTS = {
  search: AI_SEARCH_AGENTS,
  training: AI_TRAINING_AGENTS,
  privatePaths: PRIVATE_PATHS,
};
