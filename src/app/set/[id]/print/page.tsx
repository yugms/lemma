import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSetForUser } from "@/lib/sets-read";
import { loadAnswerKey } from "@/lib/print-key";
import { prepareProblem } from "@/lib/math-render";
import { Prose } from "@/components/latex";
import { difficultyLabel, formatDate } from "@/lib/format";
import { PrintButton } from "@/components/print/print-button";
import { AnswerSpace } from "@/components/print/answer-space";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Print",
  description: "A printable worksheet, with an optional answer key on its own page.",
};

/**
 * A printable worksheet.
 *
 * The other half of scanning: until now the app could mark a photograph of a
 * completed worksheet but had no way to produce one to complete. Everything
 * renders through `prepareProblem`, exactly as the practice page does, so
 * KaTeX and the plots stay in Node.
 *
 * The answer key is behind `?key=1` rather than printed alongside, for the
 * obvious reason. It re-proves ownership through `loadAnswerKey` rather than
 * trusting that the page above it already did.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, getCurrentUser()]);
  if (!user) notFound();

  const result = await loadSetForUser(id, user.id);
  if (!result) notFound();
  const { set, problems } = result;

  const wantsKey = query.key === "1";
  const key = wantsKey ? await loadAnswerKey(id, user.id) : null;

  const prepared = problems.map(prepareProblem);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Screen-only controls. `print:hidden` keeps them off the paper. */}
      <div className="print:hidden">
        <p className="eyebrow eyebrow-accent">Worksheet</p>
        <h1 className="display mt-5 text-title">{set.title}</h1>
        <p className="mt-5 max-w-xl text-prose text-muted">
          Print this, work through it on paper, then photograph it and use{" "}
          <Link href={`/set/${set.id}/scan`} className="link">
            Scan my paper
          </Link>{" "}
          to have it marked into your record.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <PrintButton />
          <Link
            href={`/set/${set.id}/print${wantsKey ? "" : "?key=1"}`}
            className="btn btn-outline btn-sm"
          >
            {wantsKey ? "Hide answer key" : "Include answer key"}
          </Link>
          <Link href={`/set/${set.id}`} className="btn btn-ghost btn-sm">
            Back to set
          </Link>
        </div>
        {wantsKey && (
          <p className="aside-rule-bad mt-7">
            The answer key prints on its own page at the end. On screen it
            follows the questions — fold it away if you are working from this.
            Don&apos;t hand this copy out.
          </p>
        )}
        <hr className="mt-10 border-line" />
      </div>

      {/* ── The sheet itself ─────────────────────────────────────────── */}

      <header className="mt-10 print:mt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
          <h2 className="display-md text-section">{set.title}</h2>
          <p className="mono-meta">
            {difficultyLabel(set.config.difficulty)} · {problems.length} problems ·{" "}
            {formatDate(set.created_at)}
          </p>
        </div>
        {/* Somewhere to write a name, because these get handed out. */}
        <div className="mt-5 flex flex-wrap gap-x-10 gap-y-3 text-sm text-muted">
          <span className="flex-1 border-b border-line pb-1">Name</span>
          <span className="w-40 border-b border-line pb-1">Date</span>
        </div>
      </header>

      <ol className="mt-8">
        {prepared.map((p) => (
          <li
            key={p.id}
            // A problem split across a page break is unusable on paper.
            className="break-inside-avoid border-b border-line py-7 last:border-b-0"
          >
            <div className="grid gap-3 sm:grid-cols-[2.5rem_1fr] sm:gap-5">
              <span className="mono-meta pt-1">{String(p.position).padStart(2, "0")}.</span>
              <div className="min-w-0">
                <Prose html={p.statement_html} className="text-[15px] leading-7" />

                {p.plot_svg && (
                  <div
                    className="mt-4 max-w-md"
                    // Rendered in Node by src/lib/plot.ts, like every other plot.
                    dangerouslySetInnerHTML={{ __html: p.plot_svg }}
                  />
                )}

                <AnswerSpace problem={p} />
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* `break-before-page` is a print rule, so on screen the key just follows
          the questions — a scroll away from the paper the student is about to
          work, on the device they are holding while working it.
          Foldable rather than folded: a closed <details> prints closed in some
          browsers and the key is the entire reason for ?key=1, so it opens by
          default and collapsing is the reader's choice. */}
      {key && key.length > 0 && (
        <details className="mt-12 break-before-page" open>
          <summary className="display-md flex flex-wrap items-baseline gap-x-3 border-b border-line pb-3 text-section">
            Answer key — {set.title}
            <span className="mono-meta print:hidden">tap to fold away</span>
          </summary>
          <ol className="mt-6 space-y-4">
            {key.map((entry) => {
              const problem = prepared.find((p) => p.position === entry.position);
              return (
                <li
                  key={entry.position}
                  className="break-inside-avoid grid gap-2 sm:grid-cols-[2.5rem_1fr] sm:gap-5"
                >
                  <span className="mono-meta pt-0.5">
                    {String(entry.position).padStart(2, "0")}.
                  </span>
                  <div className="min-w-0">
                    <Prose html={entry.answer_html} className="text-[15px] leading-7" />
                    {entry.solution_plot_svg && (
                      <div
                        className="mt-3 max-w-xs"
                        dangerouslySetInnerHTML={{ __html: entry.solution_plot_svg }}
                      />
                    )}
                    {problem?.topic_title && (
                      <p className="mono-meta mt-1.5">{problem.topic_title}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </div>
  );
}
