import { LoadingAnnouncement, ProblemCardSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <LoadingAnnouncement>Loading your flashcards</LoadingAnnouncement>
      <ProblemCardSkeleton />
    </div>
  );
}
