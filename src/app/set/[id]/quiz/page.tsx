import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSetForUser } from "@/lib/sets";
import { loadSetProgress } from "@/lib/progress";
import { prepareProblem } from "@/lib/math-render";
import { QuizEngine } from "@/components/practice/quiz-engine";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Quiz" };

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const [data, progress] = await Promise.all([
    loadSetForUser(id, user.id),
    loadSetProgress(id, user.id),
  ]);
  if (!data) notFound();

  // A quiz is one sitting over untouched problems. Once any of them has an
  // outcome the route would replay it rather than grade it, so the quiz would
  // silently score nothing — send them to practice, where that replay is the
  // intended behaviour and the worked solutions are waiting.
  if (progress.attempted > 0) redirect(`/set/${id}/practice`);

  return (
    <QuizEngine
      set={{ id: data.set.id, title: data.set.title }}
      problems={data.problems.map(prepareProblem)}
    />
  );
}
