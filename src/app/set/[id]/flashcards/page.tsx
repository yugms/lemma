import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth-server";
import { loadSetForUser } from "@/lib/sets-read";
import { prepareProblem } from "@/lib/math-render";
import { FlashcardEngine } from "@/components/practice/flashcard-engine";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Flashcards",
  description:
    "Work through a set as often as you like. Reps count toward your topic accuracy, never toward the set's own score.",
};

export default async function FlashcardsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  // No progress load: flashcard reps are unscoped by design, so a set's record
  // says nothing about which cards are due and would only mislead here.
  const data = await loadSetForUser(id, user.id);
  if (!data) notFound();

  return (
    <FlashcardEngine
      set={{ id: data.set.id, title: data.set.title }}
      problems={data.problems.map(prepareProblem)}
    />
  );
}
