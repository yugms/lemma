import {
  ListSkeleton,
  LoadingAnnouncement,
  PageHeaderSkeleton,
  StatGridSkeleton,
} from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-14">
      <LoadingAnnouncement>Loading your stats</LoadingAnnouncement>
      <PageHeaderSkeleton />
      <StatGridSkeleton />
      <ListSkeleton rows={4} />
    </div>
  );
}
