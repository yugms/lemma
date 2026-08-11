import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Clock, Eye, RotateCcw, X } from "lucide-react";
import { getCurrentUser } from "@/lib/auth-server";
import { loadDueTopics, loadMissed, REVIEW_SET_MAX } from "@/lib/review";
import { renderProse } from "@/lib/math-render";
import { Prose } from "@/components/latex";
import { RedoButton } from "@/components/review/redo-button";
import { formatLabel, formatRelativeDate } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Review",
  description:
    "The problems you actually missed, ranked worst-first and rebuilt into a fresh set — free, since nothing new has to be written.",
};

export default async function ReviewPage() {
  const user = await getCurrentUser();

  // Same gate as /stats: a review queue is built out of history, which is what
  // an account buys. Guests get the generator.
  if (!user || user.is_anonymous) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow eyebrow-accent">Review</p>
        <h1 className="display mt-5 text-title">Sign in to review what you missed.</h1>
        <p className="mt-6 text-prose text-muted">
          With an account, every problem you get wrong is kept and can be practised again
          later — which is worth more than a fresh problem on the same topic.
        </p>
        <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent btn-lg mt-9">
          Build a set
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    );
  }

  const [missed, { due, recovered }] = await Promise.all([
    loadMissed(user.id),
    loadDueTopics(user.id),
  ]);
  const queue = missed.slice(0, REVIEW_SET_MAX);

  return (
    <div className="space-y-14">
      <header>
        <p className="eyebrow eyebrow-accent">Review</p>
        <h1 className="display mt-5 text-title">
          {missed.length > 0 ? "Come back to what you missed." : "Nothing outstanding."}
        </h1>
        <p className="mt-6 max-w-xl text-prose text-muted">
          Answering a problem you once got wrong is worth more than a new problem on the
          same topic — you find out whether the gap closed, rather than whether you got
          lucky twice.
        </p>
      </header>

      {missed.length === 0 && due.length === 0 ? (
        <section className="panel px-6 py-14 text-center">
          <p className="display-md text-section">Your queue is empty</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted">
            Everything you have answered, you got right first time. Build a harder set and
            this page will fill up.
          </p>
          <Link href="/build" transitionTypes={["nav-forward"]} className="btn btn-accent mt-8">
            Build a set
          </Link>
        </section>
      ) : null}

      {queue.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
            <h2 className="eyebrow">Redo what you missed</h2>
            <p className="mono-meta">
              {missed.length} in the queue
              {missed.length > queue.length && ` · next ${queue.length}`}
            </p>
          </div>

          <ul className="mt-6 space-y-5">
            {queue.map((m) => (
              <li key={m.problemId} className="flex gap-4">
                <span
                  aria-hidden
                  className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bad-wash text-bad"
                >
                  {m.revealedOnly ? (
                    <Eye className="h-3 w-3" aria-hidden />
                  ) : (
                    <X className="h-3 w-3" strokeWidth={3} aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {/* Statement only — this page never touches the answer column. */}
                  <Prose
                    html={renderProse(m.statementLatex)}
                    className="text-[15px] leading-7"
                  />
                  <p className="mono-meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{m.topicTitle}</span>
                    <span>{formatLabel(m.format).toLowerCase()}</span>
                    <span>level {m.difficulty}</span>
                    <span className="text-bad">
                      {m.revealedOnly
                        ? "revealed"
                        : `missed ${m.misses}${m.misses === 1 ? " time" : " times"}`}
                    </span>
                    {m.recovered && (
                      <span className="text-ok">recovered on a retry</span>
                    )}
                    <span>· {formatRelativeDate(m.lastAt).toLowerCase()}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-9">
            <RedoButton count={queue.length} />
            <p className="mono-meta mt-3">
              Builds instantly — these problems already exist. Your earlier answers stay on
              record; this is a fresh set.
            </p>
          </div>
        </section>
      )}

      {due.length > 0 && (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-3">
            <h2 className="eyebrow">Due for review</h2>
            <p className="mono-meta">Untouched for two weeks or more</p>
          </div>
          <ul className="mt-6 space-y-5">
            {due.map((t) => (
              <li key={t.topicId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium">{t.title}</p>
                  <p className="mono-meta mt-1 flex flex-wrap items-center gap-x-2">
                    <Clock className="h-3 w-3" aria-hidden />
                    <span>last practised {formatRelativeDate(t.lastAt).toLowerCase()}</span>
                    <span>
                      · {t.correct}/{t.attempted} correct · level {t.difficulty}
                    </span>
                  </p>
                </div>
                <Link
                  href="/build"
                  transitionTypes={["nav-forward"]}
                  className="mono-meta inline-flex shrink-0 items-center gap-1.5 transition-colors hover:text-accent"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Practise again
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recovered > 0 && (
        <section className="panel px-6 py-8">
          <p className="eyebrow">Second attempts</p>
          <p className="mt-3 text-prose">
            You have turned <span className="text-ok">{recovered}</span> miss
            {recovered === 1 ? "" : "es"} into a correct second answer.
          </p>
          <p className="mono-meta mt-2">
            Those still count as missed on the set — but they are the ones you actually
            learned from.
          </p>
        </section>
      )}
    </div>
  );
}
