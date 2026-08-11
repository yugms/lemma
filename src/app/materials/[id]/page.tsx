import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth-server";
import { getMaterial } from "@/lib/materials";
import { loadTopicIndex } from "@/lib/catalog";
import { MATERIAL_REJECTION } from "@/lib/ai/analyze-material";
import { MaterialReview, type ReviewTopic } from "@/components/materials/material-review";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What we found",
  description:
    "The topics, level and kinds of task read out of your material — adjust anything that isn't right, then generate from it.",
};

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  // Scoped to the caller, so somebody else's id is indistinguishable from one
  // that never existed.
  const material = await getMaterial(user.id, id);
  if (!material) notFound();

  const digest = material.digest;

  if (material.status !== "ready" || !digest) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink />
        <h1 className="display-sm mt-6 text-title">We couldn&apos;t use that one</h1>
        <p className="mt-5 text-[15px] leading-relaxed text-muted">
          {/* Our copy, keyed off a closed verdict. The model's own words are
              never shown for a rejection — it had just read a file somebody
              chose, and a sentence it wrote under our heading would carry our
              authority. */}
          {digest ? MATERIAL_REJECTION[digest.verdict] : "Nothing came back from reading it."}
        </p>
        <p className="mt-6">
          <Link href="/materials" className="btn btn-outline">
            Try another
          </Link>
        </p>
      </div>
    );
  }

  const catalog = await loadTopicIndex();
  const byId = new Map(catalog.map((t) => [t.id, t]));
  // A topic deleted from the catalog since the digest was written simply drops
  // out; the route re-checks the ids against the digest anyway, so a stale one
  // could not have been built from.
  const topics: ReviewTopic[] = digest.topic_ids
    .map((topicId) => byId.get(topicId))
    .filter((t) => t !== undefined)
    .map((t) => ({ id: t.id, title: t.title, unit: t.unit_title ?? null }));

  if (topics.length === 0) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />
      <header className="pb-9 pt-6">
        <p className="eyebrow eyebrow-accent">From your material</p>
        <h1 className="display-sm mt-5 text-title">{digest.title || "Your material"}</h1>
      </header>

      <MaterialReview
        materialId={material.id}
        summary={digest.summary}
        topics={topics}
        difficulty={digest.difficulty}
        styles={digest.styles}
        formats={digest.formats}
        shift={digest.requested_shift}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/materials" className="mono-meta inline-flex items-center gap-1.5 hover:text-fg">
      <ArrowLeft className="h-3 w-3" aria-hidden />
      All material
    </Link>
  );
}
