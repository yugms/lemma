import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, ArrowRight, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth-server";
import { loadStatsSnapshot, windowFor, type StatsScope, type StatsSnapshot } from "@/lib/analytics";
import { loadLatestSession } from "@/lib/study-session";
import { loadCoachRead } from "@/lib/ai/coach";
import { prescribe } from "@/lib/coach-plan";
import { renderProse } from "@/lib/math-render";
import { Prose } from "@/components/latex";
import { Stat, StatGrid } from "@/components/stat-grid";
import { formatDuration, formatRelativeDate } from "@/lib/format";
import { ScopeToggle } from "@/components/stats/scope-toggle";
import { SessionControl } from "@/components/stats/session-control";
import { PrescriptionCard } from "@/components/stats/prescription-card";
import { AccuracyMeter, ActivityStrip, SliceList } from "@/components/stats/meters";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Stats" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  const scope: StatsScope = params.scope === "session" ? "session" : "all";

  // Guests get the generator and nothing else — history is what an account buys.
  if (!user || user.is_anonymous) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow eyebrow-accent">Stats</p>
        <h1 className="display mt-5 text-title">Sign in to see your progress.</h1>
        <p className="mt-6 text-prose text-muted">
          Once you have an account, this page shows your accuracy by topic, the
          mistakes that keep recurring, and sets built from your own practice
          record. Signing in keeps everything you have already done.
        </p>
        <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent btn-lg mt-9">
          Build a set
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  const session = await loadLatestSession(user.id);
  const snapshot = await loadStatsSnapshot(user.id, windowFor(scope, session));
  const { totals } = snapshot;
  const touched = totals.answered + totals.revealed;

  // Prescriptions are rendered from the computed snapshot alone. Their copy
  // doesn't depend on the coach read, so the cards can paint immediately while
  // the model call streams in below — and the build route re-derives the whole
  // config server-side anyway, coach directives included.
  const plans = prescribe(snapshot, null);

  return (
    <div className="space-y-14">
      <header className="space-y-6">
        <div>
          <p className="eyebrow eyebrow-accent">Stats</p>
          <h1 className="display mt-5 text-title">
            {scope === "session" ? "This session." : "Everything so far."}
          </h1>
        </div>
        <ScopeToggle scope={scope} />
        <SessionControl
          session={session}
          startedLabel={session ? formatRelativeDate(session.startedAt).toLowerCase() : ""}
          endedLabel={session?.endedAt ? formatRelativeDate(session.endedAt).toLowerCase() : ""}
          // Only the session scope computed these; on all-time they describe a
          // different window and must not be presented as the session's.
          answered={scope === "session" ? totals.answered : null}
          accuracy={scope === "session" ? totals.accuracy : null}
        />
      </header>

      {touched === 0 ? (
        <section className="panel px-6 py-14 text-center">
          <p className="display-md text-section">
            {scope === "session" && !session
              ? "No session started."
              : scope === "session"
                ? "Nothing answered in this session yet."
                : "No practice recorded yet."}
          </p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
            {scope === "session" && !session
              ? "Start a session above to measure a stretch of practice on its own — it keeps running until you end it, even if you sign out."
              : scope === "session"
                ? "Answer a few problems and this page will fill in."
                : "Build a set and answer a few problems — accuracy, weak spots, and targeted sets all come from your attempts."}
          </p>
          {!(scope === "session" && !session) && (
            <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent mt-8">
              <Sparkles className="h-4 w-4" aria-hidden />
              Build a set
            </Link>
          )}
        </section>
      ) : (
        <>
          <StatGrid label="Headline numbers" columns={4}>
            <Stat label="Answered" value={String(totals.answered)} />
            <Stat
              label="Accuracy"
              value={totals.accuracy === null ? "—" : `${totals.accuracy}%`}
            />
            <Stat
              label="Streak"
              value={String(snapshot.streak.current)}
              suffix={snapshot.streak.best > snapshot.streak.current ? `best ${snapshot.streak.best}` : "days"}
            />
            <Stat
              label="Median time"
              value={totals.medianTimeMs === null ? "—" : formatDuration(totals.medianTimeMs)}
            />
          </StatGrid>

          <Suspense fallback={<CoachSkeleton />}>
            <CoachSection userId={user.id} scope={scope} snapshot={snapshot} />
          </Suspense>

          {snapshot.weakest.length > 0 && (
            <section>
              <h2 className="eyebrow border-b border-line pb-3">What to work on</h2>
              <ul className="mt-6 space-y-8">
                {snapshot.weakest.map((t) => {
                  const note = snapshot.mistakes.find((m) => m.topicTitle === t.title);
                  return (
                    <li key={t.topicId}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="min-w-0 text-[15px] font-medium">{t.title}</p>
                        <p className="mono-meta shrink-0 tabular-nums">
                          {t.accuracy === null ? "—" : `${t.accuracy}%`}
                        </p>
                      </div>
                      <p className="mono-meta mt-1">
                        {t.courseTitle}
                        {t.unitTitle && ` · ${t.unitTitle}`}
                      </p>
                      <div className="mt-3">
                        <AccuracyMeter accuracy={t.accuracy} label={t.title} />
                      </div>
                      <p className="mono-meta mt-2 flex flex-wrap items-center gap-x-2">
                        {/* Never colour alone — the icon and the word carry it too. */}
                        <AlertTriangle className="h-3 w-3 text-bad" aria-hidden />
                        <span className="text-bad">Needs work</span>
                        <span>
                          · {t.correct}/{t.attempted} correct
                          {t.revealed > 0 && ` · ${t.revealed} revealed`}
                          {t.lastAt && ` · last ${formatRelativeDate(t.lastAt).toLowerCase()}`}
                        </span>
                      </p>
                      {note && (
                        <div className="aside-rule aside-rule-accent mt-4 py-1">
                          <p className="eyebrow">
                            Recurring
                            {note.count > 1 && ` · ${note.count} times`}
                          </p>
                          <Prose
                            html={renderProse(note.note)}
                            className="mt-1.5 text-[13px] leading-relaxed text-muted"
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {plans.length > 0 && (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
                <h2 className="eyebrow">Sets built for you</h2>
                <p className="mono-meta">Narrower than the builder can ask for</p>
              </div>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((p) => (
                  <PrescriptionCard
                    key={p.id}
                    scope={scope}
                    plan={{
                      id: p.id,
                      title: p.title,
                      rationale: p.rationale,
                      bullets: p.bullets,
                      count: p.count,
                    }}
                  />
                ))}
              </ul>
            </section>
          )}

          {snapshot.byTopic.length > 0 && (
            <section>
              <h2 className="eyebrow border-b border-line pb-3">By topic</h2>
              <ul className="mt-6 space-y-6">
                {snapshot.byTopic.map((t) => (
                  <li key={t.topicId}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <p className="min-w-0 truncate text-[14px]">{t.title}</p>
                      <p className="mono-meta shrink-0 tabular-nums">
                        {t.accuracy === null ? "—" : `${t.accuracy}%`}
                      </p>
                    </div>
                    <div className="mt-2">
                      <AccuracyMeter accuracy={t.accuracy} label={t.title} />
                    </div>
                    <p className="mono-meta mt-1.5">
                      {t.correct}/{t.attempted} correct
                      {t.revealed > 0 && ` · ${t.revealed} revealed`} · level {t.difficulty}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recall under different conditions: a gap between practice and
              quiz accuracy is the difference between "I know it" and "I know
              it with a clock running". */}
          {snapshot.byMode.length > 1 && (
            <section>
              <h2 className="eyebrow border-b border-line pb-3">How you practised</h2>
              <div className="mt-6">
                <SliceList title="" slices={snapshot.byMode} />
              </div>
            </section>
          )}

          <section className="grid gap-10 sm:grid-cols-3">
            <SliceList title="By format" slices={snapshot.byFormat} />
            <SliceList title="By style" slices={snapshot.byStyle} />
            <SliceList title="By difficulty" slices={snapshot.byDifficulty} />
          </section>

          <section>
            <h2 className="eyebrow border-b border-line pb-3">Activity</h2>
            <div className="mt-6">
              <ActivityStrip activity={snapshot.activity} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * The written read. Streamed in its own boundary so a slow — or failing — model
 * call never delays the numbers, which are the substance of the page.
 */
async function CoachSection({
  userId,
  scope,
  snapshot,
}: {
  userId: string;
  scope: StatsScope;
  snapshot: StatsSnapshot;
}) {
  const read = await loadCoachRead(userId, scope, snapshot);
  if (!read) return null;

  return (
    <section className="panel-raised p-6 sm:p-7">
      <h2 className="eyebrow eyebrow-accent">Your read</h2>
      <Prose
        html={renderProse(read.diagnosis)}
        className="mt-4 max-w-2xl text-prose leading-relaxed"
      />
      {read.focus_areas.length > 0 && (
        <ul className="mt-7 grid gap-5 border-t border-line pt-6 sm:grid-cols-3">
          {read.focus_areas.map((f) => (
            <li key={f.label}>
              <p className="text-[14px] font-medium">{f.label}</p>
              <Prose
                html={renderProse(f.why)}
                className="mt-1.5 text-[13px] leading-relaxed text-muted"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CoachSkeleton() {
  return (
    <section className="panel-raised p-6 sm:p-7" aria-hidden>
      <div className="skeleton h-2.5 w-24" />
      <div className="mt-5 space-y-2.5">
        <div className="skeleton h-3.5 w-full max-w-2xl" />
        <div className="skeleton h-3.5 w-full max-w-xl" />
        <div className="skeleton h-3.5 w-2/3 max-w-md" />
      </div>
    </section>
  );
}
