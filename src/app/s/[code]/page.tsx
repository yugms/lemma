import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSharedSet } from "@/lib/share";
import { renderProse } from "@/lib/math-render";
import { Prose } from "@/components/latex";
import { AddSharedSet } from "@/components/share/add-shared-set";
import { difficultyLabel, formatLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const shared = await loadSharedSet(code);
  return {
    title: shared ? `${shared.set.title} — shared set` : "Shared set",
    // An unlisted link stays unlisted: nothing here should end up in an index.
    robots: { index: false, follow: false },
  };
}

const PREVIEW = 3;

export default async function SharedSetPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const [{ code }, user] = await Promise.all([params, getCurrentUser()]);
  const shared = await loadSharedSet(code);
  if (!shared) notFound();

  const alreadyMine = user?.id === shared.ownerId;
  const preview = shared.problems.slice(0, PREVIEW);
  const topics = [...new Set(shared.problems.map((p) => p.topic_title).filter(Boolean))];

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow eyebrow-accent">Shared set</p>
      <h1 className="display mt-5 text-title">{shared.set.title}</h1>

      <p className="mt-6 flex flex-wrap items-center gap-1.5">
        <span className="badge">{shared.problems.length} problems</span>
        <span className="badge">{difficultyLabel(shared.set.config.difficulty)}</span>
        {topics.slice(0, 2).map((t) => (
          <span key={t} className="badge">
            {t}
          </span>
        ))}
        {topics.length > 2 && <span className="badge">+{topics.length - 2}</span>}
      </p>

      <div className="mt-9">
        <AddSharedSet code={code} alreadyMine={alreadyMine} />
      </div>

      <section className="mt-14">
        <h2 className="eyebrow border-b border-line pb-3">
          {preview.length < shared.problems.length
            ? `First ${preview.length} problems`
            : "The problems"}
        </h2>
        <ol className="mt-6 space-y-8">
          {preview.map((p, i) => (
            <li key={p.id} className="grid grid-cols-[2rem_1fr] gap-x-3">
              <span className="mono-meta leading-7">{String(i + 1).padStart(2, "0")}</span>
              <div className="min-w-0">
                {/* Statements only — this page never reads the answer column. */}
                <Prose
                  html={renderProse(p.statement_latex)}
                  className="text-[15px] leading-7"
                />
                <p className="mono-meta mt-2 flex flex-wrap gap-x-3">
                  {p.topic_title && <span>{p.topic_title}</span>}
                  <span>{formatLabel(p.format).toLowerCase()}</span>
                  <span>level {p.difficulty}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
        {shared.problems.length > preview.length && (
          <p className="mono-meta mt-8">
            {shared.problems.length - preview.length} more once you add it.
          </p>
        )}
      </section>
    </div>
  );
}
