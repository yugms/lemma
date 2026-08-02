import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSetForUser } from "@/lib/sets";
import { latestUpload } from "@/lib/worksheets";
import { ScanWorkspace } from "@/components/scan/scan-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Scan your work" };

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const result = await loadSetForUser(id, user.id);
  if (!result) notFound();
  const { set, problems } = result;

  // The last upload for this set, so a reload doesn't lose the marking — and so
  // readings still awaiting confirmation can be finished later.
  const previous = await latestUpload(user.id, id);

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href={`/set/${set.id}`}
        transitionTypes={["nav-back"]}
        className="mono-meta inline-flex items-center gap-1.5 transition-colors hover:text-accent"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        {set.title}
      </Link>

      <h1 className="display mt-6 text-title">Mark my paper.</h1>
      <p className="mt-6 text-prose text-muted">
        Work the set on paper, photograph the page, and get it marked against the same
        answer key the app uses. Correct readings go straight onto your record, so scanned
        work shows up in Review and Stats like anything else you answer.
      </p>

      <div className="mt-10">
        <ScanWorkspace
          setId={set.id}
          problemCount={problems.length}
          initialGrading={previous?.grading ?? null}
          initialUploadId={previous?.id ?? null}
        />
      </div>

      <p className="mono-meta mt-10">
        Number each answer to match the problem numbers on the set page — that is how the
        marking lines your work up.
      </p>
    </div>
  );
}
