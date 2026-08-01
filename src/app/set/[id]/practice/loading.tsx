import { LoadingAnnouncement, ProblemCardSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl">
      <LoadingAnnouncement>Loading your problems</LoadingAnnouncement>
      <div className="flex items-center justify-between gap-6 border-b border-line pb-4">
        <div className="skeleton h-3 w-40" />
        <div className="flex gap-1">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-[3px] w-6 rounded-full" />
          ))}
        </div>
      </div>
      <div className="mt-6">
        <ProblemCardSkeleton />
      </div>
    </div>
  );
}
