import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSetForUser } from "@/lib/sets";
import { loadSetProgress } from "@/lib/progress";
import { prepareProblem } from "@/lib/math-render";
import { PracticeEngine } from "@/components/practice/practice-engine";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Practice" };

/**
 * The set, its problems and any progress are all resolved here rather than
 * fetched from the browser after mount: it removes a client waterfall, and it
 * lets KaTeX render server-side so the practice route ships no math engine.
 */
export default async function PracticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const [data, progress] = await Promise.all([
    loadSetForUser(id, user.id),
    loadSetProgress(id, user.id),
  ]);
  if (!data) notFound();

  return (
    <PracticeEngine
      set={{ id: data.set.id, title: data.set.title }}
      problems={data.problems.map(prepareProblem)}
      initialOutcomes={progress.outcomes}
      // The review queue and stats are account-only, so the summary shouldn't
      // send a guest to a sign-in wall it could have predicted.
      hasAccount={!user.is_anonymous}
    />
  );
}
