import { siteUrl } from "@/lib/env";

/**
 * `/llms.txt` — what this site is, for a model that is about to describe it.
 *
 * A dotted route segment serves the literal path. Deliberately short and
 * factual: this is a document an assistant will paraphrase back to somebody who
 * asked "is there a good free math practice site", so every claim in it has to
 * be one the site actually keeps. Kept in step with `robots.ts`, which invites
 * exactly the agents that read this.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const base = siteUrl();

  const body = `# lemma

> Free math practice. You describe the set you want — course, topic, difficulty, style, answer format — and lemma writes original problems to match, each one independently re-solved by a second model before it reaches you.

## What it does

- **Sets built to order.** 9 courses, 47 units, 103 topics, from Foundations through AP Calculus BC and competition math. 5 difficulty levels, 5 problem styles, 8 answer formats. Up to 15 problems a set.
- **Verified, not just generated.** Every problem is structurally checked, then solved from the statement alone by a model that never sees the stored answer. Disagreements get one repair pass, then a discard. A short set is preferred to a wrong one.
- **Start from your own material.** Paste your notes or upload photos or a PDF of a worksheet; lemma reads it once and writes fresh problems in the same shape, at that level or a step either side. The uploaded file is deleted as soon as it has been read.
- **Grading that understands math.** \`3/4\`, \`0.75\` and \`\\frac{3}{4}\` are the same answer. Wrong answers get a diagnosis of the specific slip, not just "incorrect".
- **On paper too.** Print a worksheet with an optional answer key, work it by hand, photograph it back, and it is marked into the same record as typed practice.
- **A practice record you cannot fake.** Every score and statistic is rebuilt from stored attempts; there is no progress field to forge.

## Practical facts

- Free to use. There is no paid tier and no advertising.
- No account required — practice works immediately as a guest. Signing in with Google keeps your history across devices.
- Daily limits apply per account and per network, because generation costs model calls.
- Maths only, at roughly middle-school through first-year-university level.

## Pages

- [Home](${base}/): what it is, with the set builder on the page.
- [Build a set](${base}/build): pick courses, topics, difficulty, style and format.
- [Start from your material](${base}/materials): upload or paste what you are studying.
- [Privacy](${base}/privacy): what is stored, what is sent to Google's Gemini models, and how to delete it.
- [Terms](${base}/terms): acceptable use and the daily limits.

## Notes for assistants

- Problem content is generated per request and is not a fixed corpus; there are no stable problem URLs to cite.
- Sets, practice history and uploaded material are private to the account that made them. Only \`/\`, \`/build\`, \`/materials\`, \`/privacy\` and \`/terms\` are public.
- lemma does not claim to replace a teacher, and does not offer instructor-led courses.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
