import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, BarChart3, Check, Plus, ShieldCheck } from "lucide-react";
import { JsonLd, appGraph } from "@/components/json-ld";
import { siteUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth-server";
import { loadCatalog } from "@/lib/catalog";
import { loadProgressForSets, loadUserStats } from "@/lib/progress";
import { formatRelativeDate } from "@/lib/format";
import { BuilderForm } from "@/components/builder/builder-form";
import { Stat, StatGrid } from "@/components/stat-grid";

export const dynamic = "force-dynamic";

/** Matches the hero copy below, so the markup describes what is on the page. */
const APP_DESCRIPTION =
  "Original math problem sets built to order by course, topic, difficulty and style. Every problem is solved independently and checked before it reaches you, and comes with a worked solution.";

const STEPS = [
  {
    title: "Choose",
    body: "A whole unit, six specific topics, or a mix drawn from several courses at once. Algebra 1 through AP Calculus BC, plus competition math. Set the difficulty, the style, and the answer format.",
  },
  {
    title: "Verify",
    body: "Every problem is re-solved from scratch by a second model that never sees the answer key. Disagreements are repaired once, then discarded if they still don't hold up.",
  },
  {
    title: "Practice",
    body: "Instant grading, a worked solution for every problem, and — when you miss one — a read on the specific mistake that most likely caused it.",
  },
];

export default async function Home() {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);

  // Personalization is the payoff for signing in. A guest is an anonymous user
  // with a real id and real sets, so "has history" alone would hand them a
  // dashboard they were never offered — the check has to be the account.
  const signedIn = Boolean(user && !user.is_anonymous);

  const [setsResult, stats] = await Promise.all([
    signedIn
      ? supabase
          .from("problem_sets")
          .select("id, title, created_at, config, problem_set_items(count)")
          .order("created_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: null }),
    signedIn && user ? loadUserStats(user.id) : Promise.resolve(null),
  ]);

  const sets = (setsResult.data ?? []) as unknown as {
    id: string;
    title: string;
    created_at: string;
    config: { difficulty?: number };
    problem_set_items: { count: number }[];
  }[];

  const tallies =
    signedIn && user
      ? await loadProgressForSets(
          sets.map((s) => s.id),
          user.id
        )
      : new Map();

  const cards = sets.map((s) => {
    const total = s.problem_set_items?.[0]?.count ?? 0;
    const attempted = tallies.get(s.id)?.attempted ?? 0;
    return {
      id: s.id,
      title: s.title,
      createdAt: s.created_at,
      difficulty: s.config.difficulty ?? 1,
      total,
      attempted,
      complete: total > 0 && attempted >= total,
    };
  });

  const resume = cards.find((c) => !c.complete && c.total > 0);

  /* ── Returning student ────────────────────────────────────────── */

  if (signedIn && cards.length > 0) {
    return (
      <div className="space-y-16">
        <section>
          <p className="eyebrow eyebrow-accent">Welcome back</p>
          <h1 className="display mt-5 text-title">
            {resume ? "Pick up where you left off." : "Ready for the next set."}
          </h1>
        </section>

        {stats && stats.answered > 0 && (
          <section className="space-y-4">
            <StatGrid label="Your practice so far">
              <Stat label="Answered" value={String(stats.answered)} />
              <Stat
                label="Accuracy"
                value={stats.accuracy === null ? "—" : `${stats.accuracy}%`}
              />
              <Stat
                label="Active days"
                value={`${stats.activeDays}`}
                suffix="of last 7"
                className="col-span-2 sm:col-span-1"
              />
            </StatGrid>
            <Link
              href="/stats"
              transitionTypes={["nav-lateral"]}
              className="link inline-flex items-center gap-2 text-sm text-muted"
            >
              <BarChart3 className="h-3.5 w-3.5" aria-hidden />
              See what to work on
            </Link>
          </section>
        )}

        {resume && (
          <section>
            <h2 className="eyebrow">Continue</h2>
            <Link
              href={`/set/${resume.id}/practice`}
              transitionTypes={["nav-forward"]}
              className="panel-raised lift group mt-4 flex flex-wrap items-center justify-between gap-6 p-6 sm:p-7"
            >
              <div className="min-w-0">
                <p className="display-md text-section">{resume.title}</p>
                <p className="mono-meta mt-2.5">
                  {resume.attempted} of {resume.total} attempted · level{" "}
                  {resume.difficulty}
                </p>
                <div className="meter mt-4 w-56 max-w-full">
                  <div
                    className="meter-fill"
                    style={{ width: `${(resume.attempted / resume.total) * 100}%` }}
                  />
                </div>
              </div>
              <span className="btn btn-accent shrink-0">
                Resume
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </span>
            </Link>
          </section>
        )}

        <section>
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
            <h2 className="eyebrow">Recent sets</h2>
            <Link
              href="/sets"
              transitionTypes={["nav-lateral"]}
              className="text-sm text-muted transition-colors hover:text-accent"
            >
              All sets
            </Link>
          </div>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {cards.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/set/${c.id}`}
                  transitionTypes={["nav-forward"]}
                  className="panel lift group flex h-full flex-col justify-between gap-5 p-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{c.title}</p>
                    <p className="mono-meta mt-2">
                      {c.total} problems · {formatRelativeDate(c.createdAt)}
                    </p>
                  </div>
                  {c.complete ? (
                    <span className="badge badge-ok w-fit gap-1">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
                      Complete
                    </span>
                  ) : c.attempted > 0 ? (
                    <div className="meter">
                      <div
                        className="meter-fill"
                        style={{ width: `${(c.attempted / Math.max(c.total, 1)) * 100}%` }}
                      />
                    </div>
                  ) : (
                    <span className="badge w-fit">Not started</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel flex flex-wrap items-center justify-between gap-6 p-7">
          <div>
            <p className="display-md text-section">Build another set</p>
            <p className="mt-2 text-sm text-muted">
              Any course, any topic, any difficulty — ready in about a minute.
            </p>
          </div>
          <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent btn-lg">
            <Plus className="h-4 w-4" aria-hidden />
            New set
          </Link>
        </section>
      </div>
    );
  }

  /* ── Guest, or signed in with nothing built yet ───────────────── */

  // The generator itself is the pitch, so it goes above the fold rather than a
  // picture of one. `/build` renders the same component.
  const catalog = await loadCatalog();

  return (
    <div>
      {/* On this branch only: it is the one a crawler ever sees, since nothing
          indexing the site arrives with a session. */}
      <JsonLd data={appGraph(siteUrl(), APP_DESCRIPTION)} nonce={(await headers()).get("x-nonce")} />
      <section className="pb-4">
        <p className="eyebrow eyebrow-accent">Math practice</p>
        <h1 className="display mt-6 max-w-3xl text-hero">Problem sets built to order.</h1>
        <p className="mt-7 max-w-xl text-prose text-muted">
          Pick the topic, the difficulty, and the style. Get original problems with
          worked solutions — each one solved independently and checked before it
          reaches you.
        </p>
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          No account needed. Sign in to keep your history and get sets built from it.
        </p>
      </section>

      <section aria-label="Build a set" className="pb-16">
        <BuilderForm catalog={catalog} />
      </section>

      <section className="border-t border-line">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="reveal grid gap-3 border-b border-line py-9 sm:grid-cols-[3.5rem_11rem_1fr] sm:gap-8 sm:py-11"
          >
            <span className="mono-meta">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="display-md text-section">{s.title}</h2>
            <p className="max-w-2xl text-[15px] leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
