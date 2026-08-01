import {
  ListSkeleton,
  LoadingAnnouncement,
  PageHeaderSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-14">
      <LoadingAnnouncement>Loading your stats</LoadingAnnouncement>
      <PageHeaderSkeleton />
      <div
        aria-hidden
        className="grid grid-cols-2 gap-px overflow-hidden rounded-[5px] border border-line bg-line sm:grid-cols-4"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface px-5 py-6">
            <div className="skeleton h-2.5 w-16" />
            <div className="skeleton mt-4 h-7 w-20" />
          </div>
        ))}
      </div>
      <ListSkeleton rows={4} />
    </div>
  );
}
