import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Check, Eye, Layers, Play, Printer, ScanLine, Timer, X } from "lucide-react";
import { ShareLink } from "@/components/share/share-link";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSetForUser } from "@/lib/sets-read";
import { loadSetProgress } from "@/lib/progress";
import { renderProse } from "@/lib/math-render";
import { Prose } from "@/components/latex";
import { difficultyLabel, formatDate, formatLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Problem set" };
  const result = await loadSetForUser(id, user.id);
  return { title: result?.set.title ?? "Problem set" };
}

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const [result, progress] = await Promise.all([
    loadSetForUser(id, user.id),
    loadSetProgress(id, user.id),
  ]);
  if (!result) notFound();
  const { set, problems } = result;

  const started = progress.attempted > 0;
  const complete = progress.attempted >= problems.length && problems.length > 0;
  const graded = progress.attempted - progress.revealed;
  const pct = problems.length > 0 ? (progress.attempted / problems.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="pb-10">
        <p className="eyebrow eyebrow-accent">Problem set</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
          <div className="min-w-0">
            <h1 className="display text-title">{set.title}</h1>
            <p className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="badge">{problems.length} problems</span>
              <span className="badge">{difficultyLabel(set.config.difficulty)}</span>
              <span className="badge">{formatDate(set.created_at)}</span>
            </p>
          </div>
          <Link
            href={`/set/${set.id}/practice`}
            transitionTypes={["nav-forward"]}
            className="btn btn-accent btn-lg"
          >
            <Play className="h-3.5 w-3.5" aria-hidden />
            {complete ? "Review set" : started ? "Continue" : "Start practicing"}
          </Link>
        </div>

        {/* The same problems, three ways to work them. Quiz records real
            outcomes under timed conditions; flashcards are repeatable recall
            that deliberately never touches this set's score. */}
        <div className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2">
          {/* A quiz only runs on an untouched set — the route redirects to
              practice once anything has an outcome. Offering the button anyway
              made it look broken, so it goes away when it would no longer do
              what it says. */}
          {!started && (
            <Link
              href={`/set/${set.id}/quiz`}
              transitionTypes={["nav-forward"]}
              className="btn btn-outline btn-sm"
            >
              <Timer className="h-3.5 w-3.5" aria-hidden />
              Quiz yourself
            </Link>
          )}
          <Link
            href={`/set/${set.id}/flashcards`}
            transitionTypes={["nav-forward"]}
            className="btn btn-outline btn-sm"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            Flashcards
          </Link>
          {/* Print and scan are two halves of one loop, so they sit together:
              print the sheet, work it on paper, photograph it back in. */}
          <Link
            href={`/set/${set.id}/print`}
            transitionTypes={["nav-forward"]}
            className="btn btn-outline btn-sm"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden />
            Print worksheet
          </Link>
          <Link
            href={`/set/${set.id}/scan`}
            transitionTypes={["nav-forward"]}
            className="btn btn-outline btn-sm"
          >
            <ScanLine className="h-3.5 w-3.5" aria-hidden />
            Scan my paper
          </Link>
          <ShareLink code={set.share_code} />
        </div>

        {started && (
          <div className="mt-9">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-sm text-muted">
                {complete ? "Completed" : "In progress"} —{" "}
                <span className="text-fg">
                  {progress.attempted} of {problems.length}
                </span>{" "}
                attempted
                {graded > 0 && (
                  <>
                    , <span className="text-ok">{progress.correct} correct</span>
                  </>
                )}
                {progress.revealed > 0 && `, ${progress.revealed} revealed`}
              </p>
              <span className="mono-meta">{Math.round(pct)}%</span>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={problems.length}
              aria-valuenow={progress.attempted}
              aria-label="Set progress"
              className="meter mt-3"
            >
              <div className="meter-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </header>

      <ol className="border-t border-line">
        {problems.map((p) => {
          const outcome = progress.outcomes[p.id];
          return (
            <li
              key={p.id}
              className="grid gap-3 border-b border-line py-7 sm:grid-cols-[3rem_1fr] sm:gap-6"
            >
              <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:gap-2.5">
                <span className="mono-meta">{String(p.position).padStart(2, "0")}</span>
                {outcome === true && (
                  <span className="badge badge-ok gap-1 px-1.5">
                    <Check className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                    <span className="sr-only">Correct</span>
                  </span>
                )}
                {outcome === false && (
                  <span className="badge badge-bad gap-1 px-1.5">
                    <X className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                    <span className="sr-only">Incorrect</span>
                  </span>
                )}
                {outcome === null && (
                  <span className="badge gap-1 px-1.5">
                    <Eye className="h-3 w-3" aria-hidden />
                    <span className="sr-only">Revealed</span>
                  </span>
                )}
              </div>
              <div className="min-w-0">
                {/* Answers are stripped upstream; this is statement only. */}
                <Prose
                  html={renderProse(p.statement_latex)}
                  className="text-[15px] leading-7"
                />
                <p className="mono-meta mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {p.topic_title && <span>{p.topic_title}</span>}
                  <span>{formatLabel(p.format).toLowerCase()}</span>
                  <span>level {p.difficulty}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
